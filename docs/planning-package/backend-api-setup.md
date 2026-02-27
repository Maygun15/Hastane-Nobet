# Planlama Sistemi - Backend Setup

## 1. DATABASE MODELS

### Planning (Planlama)
```javascript
{
  _id: ObjectId,
  title: String,
  description: String,
  startDate: Date,
  endDate: Date,
  status: 'draft' | 'active' | 'completed' | 'cancelled',
  priority: 'low' | 'medium' | 'high' | 'critical',
  userId: ObjectId,
  tasks: [ObjectId], // TaskIds
  createdAt: Date,
  updatedAt: Date,
  metadata: {
    totalTasks: Number,
    completedTasks: Number,
    progress: Number (0-100)
  }
}
```

### Task (Görev)
```javascript
{
  _id: ObjectId,
  planningId: ObjectId,
  title: String,
  description: String,
  assignee: ObjectId,
  dueDate: Date,
  startDate: Date,
  status: 'todo' | 'in-progress' | 'review' | 'completed',
  priority: 'low' | 'medium' | 'high' | 'critical',
  estimatedHours: Number,
  actualHours: Number,
  dependencies: [ObjectId], // Diğer TaskIds
  subtasks: [
    {
      id: ObjectId,
      title: String,
      completed: Boolean,
      completedAt: Date
    }
  ],
  createdAt: Date,
  updatedAt: Date
}
```

## 2. API ENDPOINTS

### Planning Endpoints
```
GET    /api/v1/planning              - Tüm planlamaları listele
POST   /api/v1/planning              - Yeni planlama oluştur
GET    /api/v1/planning/:id          - Belirli planlama detayları
PUT    /api/v1/planning/:id          - Planlama güncelle
DELETE /api/v1/planning/:id          - Planlama sil
GET    /api/v1/planning/:id/tasks    - Planlamaya ait görevler
```

### Task Endpoints
```
GET    /api/v1/tasks                 - Tüm görevleri listele
POST   /api/v1/tasks                 - Yeni görev oluştur
GET    /api/v1/tasks/:id             - Belirli görev detayları
PUT    /api/v1/tasks/:id             - Görev güncelle
DELETE /api/v1/tasks/:id             - Görev sil
PATCH  /api/v1/tasks/:id/status      - Görev durumu değiştir
```

## 3. STANDARD RESPONSE FORMAT

### Success Response
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    // endpoint'e göre veri
  },
  "message": "İşlem başarılı"
}
```

### Error Response
```json
{
  "success": false,
  "statusCode": 400,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Giriş verileri geçersiz",
    "details": [
      {
        "field": "title",
        "message": "Title gereklidir"
      }
    ]
  }
}
```

## 4. REQUEST/RESPONSE EXAMPLES

### CREATE PLANNING
**Request:**
```json
POST /api/v1/planning
{
  "title": "Q1 Proje Planlaması",
  "description": "Birinci çeyrek hedefleri",
  "startDate": "2026-03-01",
  "endDate": "2026-03-31",
  "priority": "high"
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "title": "Q1 Proje Planlaması",
    "description": "Birinci çeyrek hedefleri",
    "startDate": "2026-03-01T00:00:00Z",
    "endDate": "2026-03-31T23:59:59Z",
    "status": "draft",
    "priority": "high",
    "userId": "507f1f77bcf86cd799439012",
    "tasks": [],
    "metadata": {
      "totalTasks": 0,
      "completedTasks": 0,
      "progress": 0
    },
    "createdAt": "2026-02-27T22:00:00Z",
    "updatedAt": "2026-02-27T22:00:00Z"
  },
  "message": "Planlama başarıyla oluşturuldu"
}
```

### CREATE TASK
**Request:**
```json
POST /api/v1/tasks
{
  "planningId": "507f1f77bcf86cd799439011",
  "title": "API Endpoint'lerini tasarla",
  "description": "RESTful API'nin tüm endpoint'lerini tasarla",
  "startDate": "2026-03-01",
  "dueDate": "2026-03-05",
  "priority": "high",
  "estimatedHours": 8,
  "assignee": "507f1f77bcf86cd799439012"
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "planningId": "507f1f77bcf86cd799439011",
    "title": "API Endpoint'lerini tasarla",
    "description": "RESTful API'nin tüm endpoint'lerini tasarla",
    "status": "todo",
    "priority": "high",
    "startDate": "2026-03-01T00:00:00Z",
    "dueDate": "2026-03-05T23:59:59Z",
    "estimatedHours": 8,
    "actualHours": 0,
    "assignee": "507f1f77bcf86cd799439012",
    "dependencies": [],
    "subtasks": [],
    "createdAt": "2026-02-27T22:00:00Z",
    "updatedAt": "2026-02-27T22:00:00Z"
  },
  "message": "Görev başarıyla oluşturuldu"
}
```

## 5. ERROR CODES

| Code | HTTP | Açıklama |
|------|------|----------|
| VALIDATION_ERROR | 400 | Giriş verileri geçersiz |
| NOT_FOUND | 404 | Kaynak bulunamadı |
| UNAUTHORIZED | 401 | Yetkilendirme başarısız |
| FORBIDDEN | 403 | Erişim reddedildi |
| CONFLICT | 409 | Kaynak çakışması |
| INTERNAL_ERROR | 500 | Sunucu hatası |

## 6. HEADER REQUIREMENTS

```
Content-Type: application/json
Authorization: Bearer {token}
X-Request-ID: {unique-id}  // İsteği takip etmek için
```
