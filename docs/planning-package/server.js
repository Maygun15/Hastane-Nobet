/**
 * Express Backend Server - Planlama Sistemi
 * Sağlam, scalable ve hata yönetimli
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');

const app = express();

// ============ MIDDLEWARE ============

// CORS Konfigürasyonu - Frontend erişimini düzenle
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  maxAge: 3600
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(morgan('combined'));

// ============ RESPONSE FORMATTER ============

/**
 * Standart response formatı
 */
const sendResponse = (res, statusCode, success, data, message = '', error = null) => {
  const response = {
    success,
    statusCode,
    timestamp: new Date().toISOString()
  };

  if (success) {
    response.data = data;
    response.message = message;
  } else {
    response.error = error || { message };
  }

  return res.status(statusCode).json(response);
};

// ============ ERROR HANDLER MIDDLEWARE ============

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// ============ MOCK DATABASE ============

const mockDatabase = {
  plannings: [],
  tasks: []
};

let planningIdCounter = 1;
let taskIdCounter = 1;

// ============ VALIDATION HELPERS ============

const validatePlanning = (data) => {
  const errors = [];
  
  if (!data.title || data.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title gereklidir' });
  }
  
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (start > end) {
      errors.push({ field: 'dates', message: 'Başlangıç tarihi bitiş tarihinden önce olmalıdır' });
    }
  }
  
  if (data.priority && !['low', 'medium', 'high', 'critical'].includes(data.priority)) {
    errors.push({ field: 'priority', message: 'Geçersiz öncelik seviyesi' });
  }
  
  return errors;
};

const validateTask = (data) => {
  const errors = [];
  
  if (!data.title || data.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Görev başlığı gereklidir' });
  }
  
  if (!data.planningId) {
    errors.push({ field: 'planningId', message: 'Planlama ID gereklidir' });
  }
  
  if (data.startDate && data.dueDate) {
    const start = new Date(data.startDate);
    const due = new Date(data.dueDate);
    if (start > due) {
      errors.push({ field: 'dates', message: 'Başlangıç tarihi tamamlanma tarihinden önce olmalıdır' });
    }
  }
  
  if (data.priority && !['low', 'medium', 'high', 'critical'].includes(data.priority)) {
    errors.push({ field: 'priority', message: 'Geçersiz öncelik seviyesi' });
  }
  
  return errors;
};

// ============ PLANNING ROUTES ============

// GET - Tüm planlamaları listele
app.get('/api/v1/planning', (req, res) => {
  try {
    const { status, priority, skip = 0, limit = 10 } = req.query;
    
    let filtered = mockDatabase.plannings;
    
    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }
    
    if (priority) {
      filtered = filtered.filter(p => p.priority === priority);
    }
    
    const paginated = filtered.slice(parseInt(skip), parseInt(skip) + parseInt(limit));
    
    return sendResponse(res, 200, true, {
      plannings: paginated,
      total: filtered.length,
      skip: parseInt(skip),
      limit: parseInt(limit)
    }, 'Planlamalar başarıyla alındı');
  } catch (error) {
    console.error('GET /api/v1/planning - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// POST - Yeni planlama oluştur
app.post('/api/v1/planning', (req, res) => {
  try {
    const { title, description, startDate, endDate, priority = 'medium' } = req.body;
    
    // Validation
    const validationErrors = validatePlanning(req.body);
    if (validationErrors.length > 0) {
      return sendResponse(res, 400, false, null, 'Giriş verileri geçersiz', {
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz giriş verileri',
        details: validationErrors
      });
    }
    
    const newPlanning = {
      _id: planningIdCounter++,
      title,
      description: description || '',
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : new Date(),
      status: 'draft',
      priority,
      userId: req.headers['user-id'] || 'default-user',
      tasks: [],
      metadata: {
        totalTasks: 0,
        completedTasks: 0,
        progress: 0
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    mockDatabase.plannings.push(newPlanning);
    
    return sendResponse(res, 201, true, newPlanning, 'Planlama başarıyla oluşturuldu');
  } catch (error) {
    console.error('POST /api/v1/planning - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// GET - Belirli planlama detayları
app.get('/api/v1/planning/:id', (req, res) => {
  try {
    const planning = mockDatabase.plannings.find(p => p._id == req.params.id);
    
    if (!planning) {
      return sendResponse(res, 404, false, null, 'Planlama bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile planlama bulunamadı`
      });
    }
    
    // İlişkili görevleri al
    const relatedTasks = mockDatabase.tasks.filter(t => t.planningId == req.params.id);
    
    const response = {
      ...planning,
      tasks: relatedTasks,
      metadata: {
        totalTasks: relatedTasks.length,
        completedTasks: relatedTasks.filter(t => t.status === 'completed').length,
        progress: relatedTasks.length > 0 
          ? Math.round((relatedTasks.filter(t => t.status === 'completed').length / relatedTasks.length) * 100)
          : 0
      }
    };
    
    return sendResponse(res, 200, true, response, 'Planlama başarıyla alındı');
  } catch (error) {
    console.error('GET /api/v1/planning/:id - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// PUT - Planlama güncelle
app.put('/api/v1/planning/:id', (req, res) => {
  try {
    const planning = mockDatabase.plannings.find(p => p._id == req.params.id);
    
    if (!planning) {
      return sendResponse(res, 404, false, null, 'Planlama bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile planlama bulunamadı`
      });
    }
    
    // Validation
    const validationErrors = validatePlanning(req.body);
    if (validationErrors.length > 0) {
      return sendResponse(res, 400, false, null, 'Giriş verileri geçersiz', {
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz giriş verileri',
        details: validationErrors
      });
    }
    
    // Güncelle
    Object.assign(planning, {
      title: req.body.title || planning.title,
      description: req.body.description || planning.description,
      startDate: req.body.startDate ? new Date(req.body.startDate) : planning.startDate,
      endDate: req.body.endDate ? new Date(req.body.endDate) : planning.endDate,
      priority: req.body.priority || planning.priority,
      status: req.body.status || planning.status,
      updatedAt: new Date()
    });
    
    return sendResponse(res, 200, true, planning, 'Planlama başarıyla güncellendi');
  } catch (error) {
    console.error('PUT /api/v1/planning/:id - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// DELETE - Planlama sil
app.delete('/api/v1/planning/:id', (req, res) => {
  try {
    const index = mockDatabase.plannings.findIndex(p => p._id == req.params.id);
    
    if (index === -1) {
      return sendResponse(res, 404, false, null, 'Planlama bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile planlama bulunamadı`
      });
    }
    
    const deletedPlanning = mockDatabase.plannings.splice(index, 1)[0];
    // İlişkili görevleri de sil
    mockDatabase.tasks = mockDatabase.tasks.filter(t => t.planningId != req.params.id);
    
    return sendResponse(res, 200, true, deletedPlanning, 'Planlama başarıyla silindi');
  } catch (error) {
    console.error('DELETE /api/v1/planning/:id - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ============ TASK ROUTES ============

// GET - Tüm görevleri listele
app.get('/api/v1/tasks', (req, res) => {
  try {
    const { planningId, status, priority, skip = 0, limit = 20 } = req.query;
    
    let filtered = mockDatabase.tasks;
    
    if (planningId) {
      filtered = filtered.filter(t => t.planningId == planningId);
    }
    
    if (status) {
      filtered = filtered.filter(t => t.status === status);
    }
    
    if (priority) {
      filtered = filtered.filter(t => t.priority === priority);
    }
    
    const paginated = filtered.slice(parseInt(skip), parseInt(skip) + parseInt(limit));
    
    return sendResponse(res, 200, true, {
      tasks: paginated,
      total: filtered.length,
      skip: parseInt(skip),
      limit: parseInt(limit)
    }, 'Görevler başarıyla alındı');
  } catch (error) {
    console.error('GET /api/v1/tasks - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// POST - Yeni görev oluştur
app.post('/api/v1/tasks', (req, res) => {
  try {
    const { 
      planningId, title, description, startDate, dueDate, 
      priority = 'medium', estimatedHours = 0 
    } = req.body;
    
    // Validation
    const validationErrors = validateTask(req.body);
    if (validationErrors.length > 0) {
      return sendResponse(res, 400, false, null, 'Giriş verileri geçersiz', {
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz giriş verileri',
        details: validationErrors
      });
    }
    
    // Planlama var mı kontrol et
    const planning = mockDatabase.plannings.find(p => p._id == planningId);
    if (!planning) {
      return sendResponse(res, 404, false, null, 'İlişkili planlama bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${planningId} ile planlama bulunamadı`
      });
    }
    
    const newTask = {
      _id: taskIdCounter++,
      planningId: parseInt(planningId),
      title,
      description: description || '',
      startDate: startDate ? new Date(startDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      status: 'todo',
      priority,
      estimatedHours: parseFloat(estimatedHours),
      actualHours: 0,
      assignee: req.headers['user-id'] || 'unassigned',
      dependencies: [],
      subtasks: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    mockDatabase.tasks.push(newTask);
    
    return sendResponse(res, 201, true, newTask, 'Görev başarıyla oluşturuldu');
  } catch (error) {
    console.error('POST /api/v1/tasks - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// GET - Belirli görev detayları
app.get('/api/v1/tasks/:id', (req, res) => {
  try {
    const task = mockDatabase.tasks.find(t => t._id == req.params.id);
    
    if (!task) {
      return sendResponse(res, 404, false, null, 'Görev bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile görev bulunamadı`
      });
    }
    
    return sendResponse(res, 200, true, task, 'Görev başarıyla alındı');
  } catch (error) {
    console.error('GET /api/v1/tasks/:id - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// PUT - Görev güncelle
app.put('/api/v1/tasks/:id', (req, res) => {
  try {
    const task = mockDatabase.tasks.find(t => t._id == req.params.id);
    
    if (!task) {
      return sendResponse(res, 404, false, null, 'Görev bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile görev bulunamadı`
      });
    }
    
    // Validation
    const validationErrors = validateTask({ ...task, ...req.body });
    if (validationErrors.length > 0) {
      return sendResponse(res, 400, false, null, 'Giriş verileri geçersiz', {
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz giriş verileri',
        details: validationErrors
      });
    }
    
    // Güncelle
    Object.assign(task, {
      title: req.body.title || task.title,
      description: req.body.description !== undefined ? req.body.description : task.description,
      startDate: req.body.startDate ? new Date(req.body.startDate) : task.startDate,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : task.dueDate,
      priority: req.body.priority || task.priority,
      status: req.body.status || task.status,
      estimatedHours: req.body.estimatedHours !== undefined ? parseFloat(req.body.estimatedHours) : task.estimatedHours,
      actualHours: req.body.actualHours !== undefined ? parseFloat(req.body.actualHours) : task.actualHours,
      assignee: req.body.assignee || task.assignee,
      updatedAt: new Date()
    });
    
    return sendResponse(res, 200, true, task, 'Görev başarıyla güncellendi');
  } catch (error) {
    console.error('PUT /api/v1/tasks/:id - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// PATCH - Görev durumu değiştir
app.patch('/api/v1/tasks/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return sendResponse(res, 400, false, null, 'Status gereklidir', {
        code: 'VALIDATION_ERROR',
        message: 'Status alanı boş olamaz',
        details: [{ field: 'status', message: 'Status gereklidir' }]
      });
    }
    
    const validStatuses = ['todo', 'in-progress', 'review', 'completed'];
    if (!validStatuses.includes(status)) {
      return sendResponse(res, 400, false, null, 'Geçersiz status', {
        code: 'VALIDATION_ERROR',
        message: `Status şu değerlerden biri olmalıdır: ${validStatuses.join(', ')}`,
        details: [{ field: 'status', message: 'Geçersiz status değeri' }]
      });
    }
    
    const task = mockDatabase.tasks.find(t => t._id == req.params.id);
    
    if (!task) {
      return sendResponse(res, 404, false, null, 'Görev bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile görev bulunamadı`
      });
    }
    
    task.status = status;
    task.updatedAt = new Date();
    
    return sendResponse(res, 200, true, task, 'Görev durumu başarıyla güncellendi');
  } catch (error) {
    console.error('PATCH /api/v1/tasks/:id/status - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// DELETE - Görev sil
app.delete('/api/v1/tasks/:id', (req, res) => {
  try {
    const index = mockDatabase.tasks.findIndex(t => t._id == req.params.id);
    
    if (index === -1) {
      return sendResponse(res, 404, false, null, 'Görev bulunamadı', {
        code: 'NOT_FOUND',
        message: `ID: ${req.params.id} ile görev bulunamadı`
      });
    }
    
    const deletedTask = mockDatabase.tasks.splice(index, 1)[0];
    
    return sendResponse(res, 200, true, deletedTask, 'Görev başarıyla silindi');
  } catch (error) {
    console.error('DELETE /api/v1/tasks/:id - Error:', error);
    return sendResponse(res, 500, false, null, 'Sunucu hatası', {
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ============ 404 HANDLER ============

app.use((req, res) => {
  return sendResponse(res, 404, false, null, 'Endpoint bulunamadı', {
    code: 'NOT_FOUND',
    message: `${req.method} ${req.path} endpoint'i bulunamadı`
  });
});

// ============ GLOBAL ERROR HANDLER ============

app.use((error, req, res, next) => {
  console.error('Unhandled Error:', error);
  
  return sendResponse(res, error.statusCode || 500, false, null, error.message || 'Sunucu hatası', {
    code: error.code || 'INTERNAL_ERROR',
    message: error.message || 'Beklenmeyen bir hata oluştu'
  });
});

// ============ SERVER START ============

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server başlatıldı: http://localhost:${PORT}`);
  console.log(`📊 Database: Mock (In-memory)`);
  console.log(`🔗 CORS Origin: ${corsOptions.origin}`);
  console.log(`📝 API Docs: http://localhost:${PORT}/api/v1`);
});

module.exports = app;
