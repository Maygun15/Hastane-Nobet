// routes/plannings.routes.js
const express = require('express');
const router = express.Router();
const Planning = require('../models/Planning');
const PlanningTask = require('../models/PlanningTask');
const { requireAuth, requireRole } = require('../middleware/authz');

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMsg = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

function isAdmin(req) {
  const role = String(req.user?.role || '').toLowerCase();
  return role === 'admin' || role === 'authorized' || role === 'superadmin';
}

// ─── PLANNING CRUD ─────────────────────────────────────────────────────────

// GET /api/plannings  — list with optional filters
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, priority, search, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (priority && priority !== 'all') filter.priority = priority;
    if (search) filter.title = { $regex: search, $options: 'i' };
    if (dateFrom || dateTo) {
      filter.startDate = {};
      if (dateFrom) filter.startDate.$gte = dateFrom;
      if (dateTo) filter.endDate = { $lte: dateTo };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [plannings, total] = await Promise.all([
      Planning.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Planning.countDocuments(filter),
    ]);

    // Compute task stats for each planning
    const planningIds = plannings.map((p) => p._id);
    const tasks = await PlanningTask.find({ planningId: { $in: planningIds } }, 'planningId status').lean();

    const statsMap = {};
    for (const t of tasks) {
      const key = String(t.planningId);
      if (!statsMap[key]) statsMap[key] = { total: 0, completed: 0 };
      statsMap[key].total++;
      if (t.status === 'completed') statsMap[key].completed++;
    }

    const result = plannings.map((p) => {
      const stats = statsMap[String(p._id)] || { total: 0, completed: 0 };
      const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      return { ...p, taskStats: { ...stats, progress } };
    });

    res.json({ plannings: result, total });
  } catch (err) {
    console.error('[plannings] GET /', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// GET /api/plannings/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const planning = await Planning.findById(req.params.id).lean();
    if (!planning) return res.status(404).json({ message: 'Planlama bulunamadı' });

    const tasks = await PlanningTask.find({ planningId: req.params.id }).sort({ createdAt: 1 }).lean();
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({ ...planning, tasks, taskStats: { total, completed, progress } });
  } catch (err) {
    console.error('[plannings] GET /:id', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// POST /api/plannings
router.post('/', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const { title, description, startDate, endDate, priority, status, assignedPersonnel } = req.body;
    if (!title || !startDate || !endDate) {
      return res.status(400).json({ message: 'Başlık ve tarihler zorunludur' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ message: 'Bitiş tarihi başlangıç tarihinden önce olamaz' });
    }
    const planning = await Planning.create({
      title: String(title).trim().slice(0, 100),
      description: String(description || '').trim().slice(0, 500),
      startDate,
      endDate,
      priority: priority || 'medium',
      status: status || 'active',
      assignedPersonnel: Array.isArray(assignedPersonnel) ? assignedPersonnel : [],
      createdBy: req.user?._id || null,
    });
    res.status(201).json(planning);
  } catch (err) {
    console.error('[plannings] POST /', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// PUT /api/plannings/:id
router.put('/:id', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const { title, description, startDate, endDate, priority, status, assignedPersonnel } = req.body;
    if (startDate && endDate && endDate < startDate) {
      return res.status(400).json({ message: 'Bitiş tarihi başlangıç tarihinden önce olamaz' });
    }
    const updates = {};
    if (title !== undefined) updates.title = String(title).trim().slice(0, 100);
    if (description !== undefined) updates.description = String(description).trim().slice(0, 500);
    if (startDate !== undefined) updates.startDate = startDate;
    if (endDate !== undefined) updates.endDate = endDate;
    if (priority !== undefined) updates.priority = priority;
    if (status !== undefined) updates.status = status;
    if (assignedPersonnel !== undefined) updates.assignedPersonnel = assignedPersonnel;

    const planning = await Planning.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!planning) return res.status(404).json({ message: 'Planlama bulunamadı' });
    res.json(planning);
  } catch (err) {
    console.error('[plannings] PUT /:id', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// DELETE /api/plannings/:id
router.delete('/:id', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const planning = await Planning.findByIdAndDelete(req.params.id);
    if (!planning) return res.status(404).json({ message: 'Planlama bulunamadı' });
    await PlanningTask.deleteMany({ planningId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('[plannings] DELETE /:id', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// ─── TASK CRUD ──────────────────────────────────────────────────────────────

// GET /api/plannings/tasks?planningId=xxx
router.get('/tasks/list', requireAuth, async (req, res) => {
  try {
    const { planningId } = req.query;
    const filter = planningId ? { planningId } : {};
    const tasks = await PlanningTask.find(filter).sort({ createdAt: 1 }).lean();
    res.json({ tasks, total: tasks.length });
  } catch (err) {
    console.error('[plannings] GET /tasks/list', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// POST /api/plannings/tasks
router.post('/tasks', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const { planningId, title, description, startDate, dueDate, priority, status, estimatedHours, assignedTo, assignedToName, subtasks } = req.body;
    if (!planningId || !title) {
      return res.status(400).json({ message: 'Planlama ve görev başlığı zorunludur' });
    }
    const planning = await Planning.findById(planningId);
    if (!planning) return res.status(404).json({ message: 'Planlama bulunamadı' });

    const task = await PlanningTask.create({
      planningId,
      title: String(title).trim().slice(0, 100),
      description: String(description || '').trim().slice(0, 500),
      startDate: startDate || '',
      dueDate: dueDate || '',
      priority: priority || 'medium',
      status: status || 'todo',
      estimatedHours: estimatedHours ? Number(estimatedHours) : null,
      assignedTo: assignedTo || null,
      assignedToName: assignedToName || '',
      subtasks: Array.isArray(subtasks) ? subtasks : [],
    });
    res.status(201).json(task);
  } catch (err) {
    console.error('[plannings] POST /tasks', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// PUT /api/plannings/tasks/:id
router.put('/tasks/:id', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const allowed = ['title', 'description', 'startDate', 'dueDate', 'priority', 'status', 'estimatedHours', 'actualHours', 'assignedTo', 'assignedToName', 'subtasks', 'completedDate', 'hasConflict'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.title) updates.title = String(updates.title).trim().slice(0, 100);
    if (updates.description) updates.description = String(updates.description).trim().slice(0, 500);

    const task = await PlanningTask.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!task) return res.status(404).json({ message: 'Görev bulunamadı' });
    res.json(task);
  } catch (err) {
    console.error('[plannings] PUT /tasks/:id', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// PATCH /api/plannings/tasks/:id/status
router.patch('/tasks/:id/status', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const { status } = req.body;
    const allowed = ['todo', 'in-progress', 'review', 'completed'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Geçersiz durum' });

    const updates = { status };
    if (status === 'completed') updates.completedDate = new Date().toISOString().slice(0, 10);

    const task = await PlanningTask.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!task) return res.status(404).json({ message: 'Görev bulunamadı' });
    res.json(task);
  } catch (err) {
    console.error('[plannings] PATCH /tasks/:id/status', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// DELETE /api/plannings/tasks/:id
router.delete('/tasks/:id', requireAuth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Yetki gerekli' });
  try {
    const task = await PlanningTask.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ message: 'Görev bulunamadı' });
    res.json({ success: true });
  } catch (err) {
    console.error('[plannings] DELETE /tasks/:id', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

// POST /api/plannings/tasks/check-conflicts
router.post('/tasks/check-conflicts', requireAuth, async (req, res) => {
  try {
    const { planningId, startDate, dueDate, assignedTo, excludeTaskId } = req.body;
    if (!assignedTo || !startDate || !dueDate) {
      return res.json({ conflicts: [], hasConflict: false });
    }
    const filter = {
      assignedTo,
      status: { $ne: 'completed' },
      $or: [
        { startDate: { $lte: dueDate }, dueDate: { $gte: startDate } },
      ],
    };
    if (excludeTaskId) filter._id = { $ne: excludeTaskId };

    const conflicts = await PlanningTask.find(filter, '_id title startDate dueDate planningId').lean();
    res.json({ conflicts, hasConflict: conflicts.length > 0 });
  } catch (err) {
    console.error('[plannings] POST /tasks/check-conflicts', err);
    res.status(500).json({ message: safeMsg(err) });
  }
});

module.exports = router;
