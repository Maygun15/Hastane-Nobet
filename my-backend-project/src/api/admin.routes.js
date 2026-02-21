const express = require('express');
const router  = express.Router();
const User    = require('../models/User.js');
const { requireRole } = require('../middlewares/authz'); // admin rolü doğrulasın

// Kullanıcıya servis atama (kalıcı)
router.post('/admin/users/:id/services', requireRole('admin'), async (req, res) => {
  const { serviceIds } = req.body || {};
  if (!Array.isArray(serviceIds)) {
    return res.status(400).json({ error: 'serviceIds array olmalı' });
  }
  const normalized = serviceIds.map(String).filter(Boolean);

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { serviceIds: normalized },
    { new: true }
  );
  if (!user) return res.status(404).json({ error: 'Kullanıcı yok' });

  res.json({ ok: true, user });
});

module.exports = router;
