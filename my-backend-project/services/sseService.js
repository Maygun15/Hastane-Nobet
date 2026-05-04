// services/sseService.js — Server-Sent Events bağlantı yöneticisi
// Lightweight, no socket.io dependency — HTTP/1.1 compatible

const clients = new Map(); // userId (string) → Set<Response>

function register(userId, res) {
  const uid = String(userId || 'anon');
  if (!clients.has(uid)) clients.set(uid, new Set());
  clients.get(uid).add(res);

  // Temizle: bağlantı kapandığında
  res.on('close', () => {
    const set = clients.get(uid);
    if (set) {
      set.delete(res);
      if (!set.size) clients.delete(uid);
    }
  });
}

function send(res, event, data) {
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
  } catch {}
}

function broadcast(userIds, event, data) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  for (const uid of ids) {
    const set = clients.get(String(uid || ''));
    if (!set?.size) continue;
    for (const res of set) send(res, event, data);
  }
}

function broadcastAll(event, data) {
  for (const set of clients.values()) {
    for (const res of set) send(res, event, data);
  }
}

function connectionCount() { return clients.size; }

module.exports = { register, broadcast, broadcastAll, connectionCount };
