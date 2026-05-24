// routes/reports.routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Request = require('../models/Request');
const { requireRole } = require('../middleware/authz');

function toOid(id) {
  if (!id) return null;
  try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; }
}

// GET /api/reports/monthly-hours?year=2025&month=5
router.get('/monthly-hours', requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const hid   = toOid(req.hospitalId);
    if (!hid) return res.status(400).json({ message: 'hospitalId gerekli' });

    const agg = await Assignment.aggregate([
      { $match: { hospitalId: hid, year, month, status: 'active' } },
      { $group: {
          _id: '$personId',
          personName:       { $first: '$personName' },
          serviceId:        { $first: '$serviceId' },
          totalAssignments: { $sum: 1 },
          totalHours:       { $sum: '$hours' },
          nightShifts:      { $sum: { $cond: [{ $in: ['$shiftCode', ['N', 'V1', 'V2', 'SV']] }, 1, 0] } },
          shifts:           { $addToSet: '$shiftCode' },
      }},
      { $sort: { totalHours: -1 } },
    ]);

    res.json({ year, month, data: agg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/reports/staff-performance?year=&month=&targetHours=
// Returns per-person: totalShifts, totalHours, targetHours, targetDiff
router.get('/staff-performance', requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const targetHours = Number(req.query.targetHours) || 160;
    const hid = toOid(req.hospitalId);
    if (!hid) return res.status(400).json({ message: 'hospitalId gerekli' });

    const agg = await Assignment.aggregate([
      { $match: { hospitalId: hid, year, month, status: 'active' } },
      { $group: {
          _id: '$personId',
          personName:   { $first: '$personName' },
          serviceId:    { $first: '$serviceId' },
          totalShifts:  { $sum: 1 },
          totalHours:   { $sum: { $ifNull: ['$hours', 0] } },
          nightShifts:  { $sum: { $cond: [{ $in: ['$shiftCode', ['N', 'V1', 'V2', 'SV']] }, 1, 0] } },
          shiftCodes:   { $addToSet: '$shiftCode' },
      }},
      { $addFields: {
          targetHours: targetHours,
          targetDiff:  { $subtract: ['$totalHours', targetHours] },
      }},
      { $sort: { totalHours: -1 } },
    ]);

    res.json({ year, month, targetHours, data: agg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/reports/leave-stats?year=2025
router.get('/leave-stats', requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const hid  = toOid(req.hospitalId);
    if (!hid) return res.status(400).json({ message: 'hospitalId gerekli' });

    const [byStatus, byType] = await Promise.all([
      Request.aggregate([
        { $match: {
            hospitalId: hid,
            type: 'izin',
            createdAt: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
        }},
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Request.aggregate([
        { $match: {
            hospitalId: hid,
            createdAt: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
        }},
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ year, byStatus, byType });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
