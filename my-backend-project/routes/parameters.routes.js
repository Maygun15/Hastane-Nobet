// routes/parameters.routes.js
const express = require('express');
const router = express.Router();
const path = require('path');

// Models
const WorkArea = require(path.join(__dirname, '..', 'models', 'WorkArea.js'));
const WorkingHours = require(path.join(__dirname, '..', 'models', 'WorkingHours.js'));
const LeaveType = require(path.join(__dirname, '..', 'models', 'LeaveType.js'));
const CalendarSetting = require(path.join(__dirname, '..', 'models', 'CalendarSetting.js'));
const RequestType = require(path.join(__dirname, '..', 'models', 'RequestType.js'));

/* ============ WORK AREAS ============ */

// GET all work areas
router.get('/work-areas', async (req, res) => {
  try {
    const areas = await WorkArea.find().sort({ createdAt: -1 }).lean();
    res.json({ ok: true, data: areas });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET work area by ID
router.get('/work-areas/:id', async (req, res) => {
  try {
    const area = await WorkArea.findById(req.params.id).lean();
    if (!area) return res.status(404).json({ message: 'Çalışma alanı bulunamadı' });
    res.json({ ok: true, data: area });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST new work area
router.post('/work-areas', async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ message: 'İsim gerekli' });
    
    const area = await WorkArea.create({
      name: name.trim(),
      description: description || '',
      color: color || '#3b82f6'
    });
    
    res.status(201).json({ ok: true, data: area });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT update work area
router.put('/work-areas/:id', async (req, res) => {
  try {
    const { name, description, color, status } = req.body;
    const area = await WorkArea.findByIdAndUpdate(
      req.params.id,
      { name, description, color, status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!area) return res.status(404).json({ message: 'Çalışma alanı bulunamadı' });
    res.json({ ok: true, data: area });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE work area
router.delete('/work-areas/:id', async (req, res) => {
  try {
    const area = await WorkArea.findByIdAndDelete(req.params.id);
    if (!area) return res.status(404).json({ message: 'Çalışma alanı bulunamadı' });
    res.json({ ok: true, message: 'Silindi' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ============ WORKING HOURS ============ */

// GET all working hours
router.get('/working-hours', async (req, res) => {
  try {
    const hours = await WorkingHours.find()
      .populate('workAreaId', 'name')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, data: hours });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET working hours by ID
router.get('/working-hours/:id', async (req, res) => {
  try {
    const hours = await WorkingHours.findById(req.params.id)
      .populate('workAreaId', 'name')
      .lean();
    if (!hours) return res.status(404).json({ message: 'Çalışma saati bulunamadı' });
    res.json({ ok: true, data: hours });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST new working hours
router.post('/working-hours', async (req, res) => {
  try {
    const { name, startTime, endTime, workAreaId, isDefault } = req.body;
    if (!name || !startTime || !endTime) {
      return res.status(400).json({ message: 'İsim, başlangıç ve bitiş saati gerekli' });
    }
    
    const hours = await WorkingHours.create({
      name: name.trim(),
      startTime,
      endTime,
      workAreaId: workAreaId || null,
      isDefault: isDefault || false
    });
    
    res.status(201).json({ ok: true, data: hours });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT update working hours
router.put('/working-hours/:id', async (req, res) => {
  try {
    const { name, startTime, endTime, workAreaId, isDefault, status } = req.body;
    const hours = await WorkingHours.findByIdAndUpdate(
      req.params.id,
      { name, startTime, endTime, workAreaId, isDefault, status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!hours) return res.status(404).json({ message: 'Çalışma saati bulunamadı' });
    res.json({ ok: true, data: hours });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE working hours
router.delete('/working-hours/:id', async (req, res) => {
  try {
    const hours = await WorkingHours.findByIdAndDelete(req.params.id);
    if (!hours) return res.status(404).json({ message: 'Çalışma saati bulunamadı' });
    res.json({ ok: true, message: 'Silindi' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ============ LEAVE TYPES ============ */

// GET all leave types
router.get('/leave-types', async (req, res) => {
  try {
    const types = await LeaveType.find().sort({ createdAt: -1 }).lean();
    res.json({ ok: true, data: types });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET leave type by ID
router.get('/leave-types/:id', async (req, res) => {
  try {
    const type = await LeaveType.findById(req.params.id).lean();
    if (!type) return res.status(404).json({ message: 'İzin türü bulunamadı' });
    res.json({ ok: true, data: type });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST new leave type
router.post('/leave-types', async (req, res) => {
  try {
    const { name, description, color, category, maxDaysPerYear, paidLeave } = req.body;
    if (!name) return res.status(400).json({ message: 'İsim gerekli' });
    
    const type = await LeaveType.create({
      name: name.trim(),
      description: description || '',
      color: color || '#ef4444',
      category: category || 'other',
      maxDaysPerYear: maxDaysPerYear || null,
      paidLeave: paidLeave !== undefined ? paidLeave : true
    });
    
    res.status(201).json({ ok: true, data: type });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT update leave type
router.put('/leave-types/:id', async (req, res) => {
  try {
    const updates = req.body;
    updates.updatedAt = new Date();
    
    const type = await LeaveType.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    
    if (!type) return res.status(404).json({ message: 'İzin türü bulunamadı' });
    res.json({ ok: true, data: type });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE leave type
router.delete('/leave-types/:id', async (req, res) => {
  try {
    const type = await LeaveType.findByIdAndDelete(req.params.id);
    if (!type) return res.status(404).json({ message: 'İzin türü bulunamadı' });
    res.json({ ok: true, message: 'Silindi' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ============ CALENDAR SETTINGS ============ */

// GET all calendar settings
router.get('/calendar', async (req, res) => {
  try {
    const { year, month } = req.query;
    let query = {};
    
    if (year) query.year = parseInt(year);
    if (month) query.month = parseInt(month);
    
    const settings = await CalendarSetting.find(query)
      .populate('createdBy', 'name email')
      .sort({ date: -1 })
      .lean();
    
    res.json({ ok: true, data: settings });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET calendar setting by ID
router.get('/calendar/:id', async (req, res) => {
  try {
    const setting = await CalendarSetting.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();
    if (!setting) return res.status(404).json({ message: 'Takvim ayarı bulunamadı' });
    res.json({ ok: true, data: setting });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST new calendar setting
router.post('/calendar', async (req, res) => {
  try {
    const { name, date, type, isHoliday, startDate, endDate } = req.body;
    if (!name || !date) return res.status(400).json({ message: 'İsim ve tarih gerekli' });
    
    const dateObj = new Date(date);
    const setting = await CalendarSetting.create({
      name: name.trim(),
      date: dateObj,
      year: dateObj.getFullYear(),
      month: dateObj.getMonth() + 1,
      type: type || 'holiday',
      isHoliday: isHoliday !== undefined ? isHoliday : true,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      createdBy: req.user?.uid || null
    });
    
    res.status(201).json({ ok: true, data: setting });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT update calendar setting
router.put('/calendar/:id', async (req, res) => {
  try {
    const updates = req.body;
    updates.updatedAt = new Date();
    
    if (updates.date) {
      const dateObj = new Date(updates.date);
      updates.year = dateObj.getFullYear();
      updates.month = dateObj.getMonth() + 1;
    }
    
    const setting = await CalendarSetting.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    
    if (!setting) return res.status(404).json({ message: 'Takvim ayarı bulunamadı' });
    res.json({ ok: true, data: setting });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE calendar setting
router.delete('/calendar/:id', async (req, res) => {
  try {
    const setting = await CalendarSetting.findByIdAndDelete(req.params.id);
    if (!setting) return res.status(404).json({ message: 'Takvim ayarı bulunamadı' });
    res.json({ ok: true, message: 'Silindi' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ============ REQUEST TYPES ============ */

// GET all request types
router.get('/request-types', async (req, res) => {
  try {
    const types = await RequestType.find().sort({ createdAt: -1 }).lean();
    res.json({ ok: true, data: types });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET request type by ID
router.get('/request-types/:id', async (req, res) => {
  try {
    const type = await RequestType.findById(req.params.id).lean();
    if (!type) return res.status(404).json({ message: 'İstek türü bulunamadı' });
    res.json({ ok: true, data: type });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST new request type
router.post('/request-types', async (req, res) => {
  try {
    const { name, description, category, requiresApproval } = req.body;
    if (!name) return res.status(400).json({ message: 'İsim gerekli' });
    
    const type = await RequestType.create({
      name: name.trim(),
      description: description || '',
      category: category || 'other',
      requiresApproval: requiresApproval !== undefined ? requiresApproval : true
    });
    
    res.status(201).json({ ok: true, data: type });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT update request type
router.put('/request-types/:id', async (req, res) => {
  try {
    const updates = req.body;
    updates.updatedAt = new Date();
    
    const type = await RequestType.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    
    if (!type) return res.status(404).json({ message: 'İstek türü bulunamadı' });
    res.json({ ok: true, data: type });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE request type
router.delete('/request-types/:id', async (req, res) => {
  try {
    const type = await RequestType.findByIdAndDelete(req.params.id);
    if (!type) return res.status(404).json({ message: 'İstek türü bulunamadı' });
    res.json({ ok: true, message: 'Silindi' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
