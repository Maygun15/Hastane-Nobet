// routes/scheduler.routes.js
const express = require('express');
const router  = express.Router();

const { requireAuth, requireRole }        = require('../middleware/authz');
const { scheduleGenerateSchema, validate } = require('../middleware/validate');
const { generateSchedule }                = require('../services/schedulerService');
const { enqueueScheduleJob, getJob }      = require('../services/schedulerJobRunner');
const { computeQualityScore }             = require('../services/scheduleQuality');
const { suggestSwaps }                    = require('../services/swapSuggestionService');
const { llmChat }                         = require('../services/llmService');

const isProd      = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

function parseBody(req) {
  const b = req.body || {};
  const sectionId = String(b.sectionId || '').trim();
  const serviceId = String(b.serviceId || '').trim();
  const role      = String(b.role      || '').trim();
  const year      = Number(b.year);
  const month     = Number(b.month);
  if (!sectionId)                    throw new Error('sectionId gerekli');
  if (!year  || year  < 2000)        throw new Error('year geçersiz');
  if (!month || month < 1 || month > 12) throw new Error('month 1..12 aralığında olmalı');
  return { sectionId, serviceId, role, year, month, dryRun: !!b.dryRun, payload: b };
}

/* ─────────────────────────────────────────────────────────────────
   POST /api/scheduler/generate
   Async: enqueues a background job, returns { jobId } immediately.
   Sync fallback via ?sync=true for backward compatibility.
   ───────────────────────────────────────────────────────────────── */
router.post('/generate', requireAuth, requireRole('admin', 'authorized'), validate(scheduleGenerateSchema), async (req, res) => {
  try {
    const params    = parseBody(req);
    const userId    = req.user?.uid || null;
    const hospitalId = req.hospitalId || null;
    const syncMode  = req.query.sync === 'true' || req.body.sync === true;

    if (syncMode) {
      // Legacy / dryRun: run synchronously and return full result
      const result = await generateSchedule({ ...params, userId, payload: params.payload, hospitalId });
      const quality = computeQualityScore({
        assignments:  result?.data?.assignments  || [],
        issues:       result?.data?.issues       || [],
        requiredSlots: result?.data?.debug?.requiredSlots || 0,
      });
      return res.json({ ok: true, ...result, quality });
    }

    // Async path
    const jobId = await enqueueScheduleJob({ ...params, userId, payload: params.payload, hospitalId });
    return res.status(202).json({ ok: true, jobId, status: 'queued' });
  } catch (err) {
    console.error('[POST /api/scheduler/generate] ERR:', err);
    return res.status(400).json({ ok: false, message: safeMessage(err, err.message) });
  }
});

/* ─────────────────────────────────────────────────────────────────
   GET /api/scheduler/jobs/:jobId
   Poll async job status. When done, result includes quality score.
   ───────────────────────────────────────────────────────────────── */
router.get('/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Job bulunamadı' });

    // Scope check: admins see all, others only their own
    if (!['admin', 'authorized'].includes(req.user?.role)) {
      const jobUser = String(job.createdBy || '');
      if (jobUser && jobUser !== String(req.user?.uid || '')) {
        return res.status(403).json({ ok: false, message: 'Yetkisiz' });
      }
    }

    let quality = null;
    if (job.status === 'done' && job.result?.data) {
      quality = computeQualityScore({
        assignments:  job.result.data.assignments  || [],
        issues:       job.result.data.issues       || [],
        requiredSlots: job.result.data.debug?.requiredSlots || 0,
      });
    }

    return res.json({
      ok: true,
      jobId:      String(job._id),
      status:     job.status,
      params:     job.params,
      durationMs: job.durationMs,
      createdAt:  job.createdAt,
      startedAt:  job.startedAt,
      finishedAt: job.finishedAt,
      error:      job.error || null,
      result:     job.status === 'done' ? job.result : null,
      quality,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

/* ─────────────────────────────────────────────────────────────────
   POST /api/scheduler/explain
   LLM explanation: "Neden bu atama yapıldı?"
   Body: { assignment, context? }
     assignment: { personName, date, shiftId, shiftLabel?, hours? }
     context:    { rules?, issues?, qualityScore? }
   ───────────────────────────────────────────────────────────────── */
router.post('/explain', requireAuth, async (req, res) => {
  try {
    const { assignment, context = {} } = req.body || {};
    if (!assignment?.personName || !assignment?.date || !assignment?.shiftId) {
      return res.status(400).json({ ok: false, message: 'assignment.personName, date, shiftId zorunlu' });
    }

    const { personName, date, shiftId, shiftLabel, hours } = assignment;
    const { rules = {}, issues = [], qualityScore = null } = context;

    // KVKK: gerçek isim LLM'e gitmesin — pozisyon tabanlı pseudonym kullan
    let h = 0;
    for (let i = 0; i < (personName || '').length; i++) h = (Math.imul(31, h) + personName.charCodeAt(i)) | 0;
    const personRef = `Personel-${Math.abs(h).toString(36).slice(0, 4).toUpperCase()}`;

    const activeRules = Object.entries(rules)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'Varsayılan kurallar';

    const issueLines = (Array.isArray(issues) ? issues : [])
      .filter((i) => i?.date === date || !i?.date)
      .slice(0, 3)
      .map((i) => `• ${i.date} / ${i.shiftId}: ${i.reason || 'Eksik atama'}`)
      .join('\n') || 'Sorun yok';

    const userPrompt = `Çizelge ataması:
- Kişi: ${personRef}
- Tarih: ${date}
- Vardiya: ${shiftId}${shiftLabel ? ` (${shiftLabel})` : ''}${hours ? `, ${hours} saat` : ''}

Aktif kurallar: ${activeRules}
${qualityScore !== null ? `Çizelge kalite puanı: ${qualityScore}/100` : ''}

O gün çizelgedeki sorunlar:
${issueLines}

Neden bu kişi bu vardiyaya atandı? Kısa ve anlaşılır Türkçe bir açıklama yaz (2-4 cümle).`;

    const result = await llmChat({
      systemPrompt: 'Sen bir hastane nöbet çizelgesi asistanısın. Türkçe, kısa ve net yanıtlar ver.',
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 256,
      action: 'explain-assignment',
      hospitalId: req.hospitalId || null,
      userId:     req.user?.uid  || null,
    });

    return res.json({
      ok: true,
      explanation: result.content,
      _meta: {
        model:      result.model,
        durationMs: result.durationMs,
        tokens:     { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
      },
    });
  } catch (err) {
    console.error('[POST /api/scheduler/explain]', err?.message || err);
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

/* ─────────────────────────────────────────────────────────────────
   POST /api/scheduler/swap-suggestions
   Find compatible swap partners for a given assignment slot.
   Body: { personId, date, shiftId, serviceId?, limit? }
   ───────────────────────────────────────────────────────────────── */
router.post('/swap-suggestions', requireAuth, async (req, res) => {
  try {
    const { personId, date, shiftId, serviceId, limit } = req.body || {};
    if (!personId || !date || !shiftId) {
      return res.status(400).json({ ok: false, message: 'personId, date, shiftId zorunlu' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, message: 'date YYYY-MM-DD formatında olmalı' });
    }

    const result = await suggestSwaps({
      personId,
      date,
      shiftId,
      serviceId: serviceId || null,
      hospitalId: req.hospitalId || null,
      limit: limit ? Math.min(Number(limit), 20) : 5,
    });

    return res.json(result);
  } catch (err) {
    console.error('[POST /api/scheduler/swap-suggestions]', err?.message || err);
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

module.exports = router;
