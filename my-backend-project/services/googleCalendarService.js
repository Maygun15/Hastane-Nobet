const crypto = require('crypto');
const axios = require('axios');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google Calendar OAuth ayarları eksik');
  }
  return { clientId, clientSecret, redirectUri };
}

function buildAuthUrl(state) {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = getConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const { data } = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return normalizeTokenResponse(data);
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const { data } = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return normalizeTokenResponse(data);
}

function normalizeTokenResponse(data = {}) {
  const expiresIn = Number(data.expires_in || 3600);
  return {
    accessToken: data.access_token || '',
    refreshToken: data.refresh_token || '',
    scope: data.scope || '',
    expiryDate: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000),
  };
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_REMINDER_MINUTES = [480];

function buildEventPayload(assignment, reminderMinutes = DEFAULT_REMINDER_MINUTES) {
  const date = String(assignment?.date || '').slice(0, 10);
  const shift = String(assignment?.shiftCode || assignment?.shiftId || '').trim();
  const roleLabel = String(assignment?.roleLabel || assignment?.taskKey || 'Nöbet').trim();
  const serviceLabel = String(assignment?.serviceId || '').trim();
  const personName = String(assignment?.personName || '').trim();
  const summary = [shift, roleLabel].filter(Boolean).join(' ') || 'Nöbet';
  const description = [
    personName ? `Personel: ${personName}` : '',
    roleLabel ? `Görev: ${roleLabel}` : '',
    shift ? `Vardiya: ${shift}` : '',
    serviceLabel ? `Servis: ${serviceLabel}` : '',
    Number.isFinite(Number(assignment?.hours)) ? `Saat: ${Number(assignment.hours)} saat` : '',
    'Kaynak: Hastane Nöbet Sistemi',
  ].filter(Boolean).join('\n');

  return {
    summary: `Nöbet: ${summary}`,
    description,
    start: { date, timeZone: 'Europe/Istanbul' },
    end: { date: addOneDay(date), timeZone: 'Europe/Istanbul' },
    reminders: {
      useDefault: false,
      overrides: (Array.isArray(reminderMinutes) ? reminderMinutes : DEFAULT_REMINDER_MINUTES)
        .map((minutes) => Number(minutes))
        .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
        .slice(0, 5)
        .map((minutes) => ({ method: 'popup', minutes })),
    },
    extendedProperties: {
      private: {
        hospitalRosterAssignmentId: String(assignment?._id || ''),
        hospitalRosterDate: date,
      },
    },
  };
}

async function calendarRequest({ accessToken, method = 'GET', url, data }) {
  const response = await axios({
    method,
    url,
    data,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

async function createEvent({ accessToken, calendarId = 'primary', payload }) {
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  return calendarRequest({
    accessToken,
    method: 'POST',
    url: `${CALENDAR_BASE}/calendars/${encodedCalendarId}/events`,
    data: payload,
  });
}

async function updateEvent({ accessToken, calendarId = 'primary', eventId, payload }) {
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  const encodedEventId = encodeURIComponent(eventId);
  return calendarRequest({
    accessToken,
    method: 'PATCH',
    url: `${CALENDAR_BASE}/calendars/${encodedCalendarId}/events/${encodedEventId}`,
    data: payload,
  });
}

module.exports = {
  SCOPE,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  buildEventPayload,
  hashPayload,
  createEvent,
  updateEvent,
  DEFAULT_REMINDER_MINUTES,
};
