# 📖 Hızlı Referans Kılavuzu

## 🚀 QUICK START COMMANDS

```bash
# Backend Başlat
cd backend
npm install
npm run dev
# → http://localhost:5000

# Frontend Başlat
cd frontend
npm install
npm start
# → http://localhost:3000

# Health Check
curl http://localhost:5000/health
```

---

## 📡 API QUICK REFERENCE

### Planlama - Create
```bash
curl -X POST http://localhost:5000/api/v1/planning \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q1 2026",
    "description": "First quarter",
    "startDate": "2026-03-01",
    "endDate": "2026-03-31",
    "priority": "high"
  }'
```

### Planlama - List
```bash
curl http://localhost:5000/api/v1/planning
curl http://localhost:5000/api/v1/planning?status=active&priority=high
```

### Planlama - Get by ID
```bash
curl http://localhost:5000/api/v1/planning/1
```

### Planlama - Update
```bash
curl -X PUT http://localhost:5000/api/v1/planning/1 \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Title", "status": "active"}'
```

### Planlama - Delete
```bash
curl -X DELETE http://localhost:5000/api/v1/planning/1
```

### Görev - Create
```bash
curl -X POST http://localhost:5000/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "planningId": 1,
    "title": "Build API",
    "startDate": "2026-03-01",
    "dueDate": "2026-03-05",
    "priority": "high",
    "estimatedHours": 8
  }'
```

### Görev - Update Status
```bash
curl -X PATCH http://localhost:5000/api/v1/tasks/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

---

## 🎯 FRONTEND USAGE

### Import Hook'lar
```javascript
import { usePlanning, useTasks } from './services/api-service';
```

### Planning Hook
```javascript
const {
  plannings,          // Planning array
  loading,            // Loading state
  error,              // Error object
  fetchPlannings,     // Fetch all
  fetchPlanningById,  // Fetch one
  createPlanning,     // Create
  updatePlanning,     // Update
  deletePlanning      // Delete
} = usePlanning();
```

### Tasks Hook
```javascript
const {
  tasks,              // Task array
  loading,            // Loading state
  error,              // Error object
  fetchTasks,         // Fetch all
  fetchTaskById,      // Fetch one
  createTask,         // Create
  updateTask,         // Update
  updateTaskStatus,   // Change status
  deleteTask          // Delete
} = useTasks();
```

### Örnek Kullanım
```javascript
// Veri yükle
useEffect(() => {
  const load = async () => {
    try {
      await fetchPlannings();
    } catch (error) {
      console.error('Error:', error.message);
    }
  };
  load();
}, []);

// Planlama oluştur
const handleCreate = async (formData) => {
  try {
    const planning = await createPlanning(formData);
    console.log('Created:', planning);
  } catch (error) {
    showError(error.message);
  }
};
```

---

## 🧩 COMPONENT QUICK REFERENCE

### PlanningCard
```javascript
<PlanningCard
  planning={planning}
  isSelected={true}
  onClick={() => setSelected(planning)}
  onEdit={(id) => editPlanning(id)}
  onDelete={(id) => deletePlanning(id)}
/>
```

### TaskItem
```javascript
<TaskItem
  task={task}
  onClick={() => editTask(task)}
  onStatusChange={(id, status) => updateStatus(id, status)}
  onDelete={(id) => deleteTask(id)}
/>
```

### PlanningForm
```javascript
<PlanningForm
  planning={editingPlanning}
  onSubmit={handleSave}
  onCancel={handleCancel}
  isLoading={loading}
/>
```

### TaskForm
```javascript
<TaskForm
  task={editingTask}
  planningId={selectedPlanning._id}
  onSubmit={handleSave}
  onCancel={handleCancel}
  isLoading={loading}
/>
```

### CalendarView
```javascript
<CalendarView 
  plannings={plannings} 
  tasks={tasks} 
/>
```

### TimelineView
```javascript
<TimelineView 
  plannings={plannings} 
/>
```

---

## 🔧 ENVIRONMENT VARIABLES

### Backend (.env)
```
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:5000
```

---

## 🐛 DEBUGGING TIPS

### Network Requests
```javascript
// Console'da:
console.log('Pending requests');

// Network tab'da:
// 1. Request'i seç
// 2. Headers tab'ını kontrol et
// 3. Response tab'ını kontrol et
```

### API Service Logs
```javascript
// Zaten built-in:
📤 API Request: POST /api/v1/planning
📥 API Response: POST /api/v1/planning
❌ API Error: GET /api/v1/tasks/999
```

### State Debugging
```javascript
// React DevTools
// 1. Profiler açıp state'i izle
// 2. Component tree'de hook'ları kontrol et
```

---

## 🔄 COMMON WORKFLOWS

### Planlama Oluştur → Görev Ekle
```javascript
// 1. Planlama oluştur
const planning = await createPlanning(planData);

// 2. Görev oluştur
const task = await createTask({
  planningId: planning._id,
  ...taskData
});
```

### Görev Durumunu Değiştir
```javascript
// Todo → In Progress
await updateTaskStatus(taskId, 'in-progress');

// In Progress → Completed
await updateTaskStatus(taskId, 'completed');
```

### Filtreleme
```javascript
const filtered = plannings.filter(p => 
  p.status === 'active' && 
  p.priority === 'high'
);
```

---

## 📊 DATA MODELS

### Planning Object
```javascript
{
  _id: 1,
  title: "Q1 2026",
  description: "First quarter",
  startDate: "2026-03-01T00:00:00Z",
  endDate: "2026-03-31T23:59:59Z",
  status: "active",           // draft, active, completed, cancelled
  priority: "high",           // low, medium, high, critical
  userId: "user-123",
  tasks: [1, 2, 3],
  metadata: {
    totalTasks: 3,
    completedTasks: 1,
    progress: 33                // 0-100
  },
  createdAt: "2026-02-27T...",
  updatedAt: "2026-02-27T..."
}
```

### Task Object
```javascript
{
  _id: 1,
  planningId: 1,
  title: "Build API",
  description: "Create endpoints",
  startDate: "2026-03-01T00:00:00Z",
  dueDate: "2026-03-05T23:59:59Z",
  status: "in-progress",      // todo, in-progress, review, completed
  priority: "high",           // low, medium, high, critical
  estimatedHours: 8,
  actualHours: 5.5,
  assignee: "user-123",
  dependencies: [],
  subtasks: [],
  createdAt: "2026-02-27T...",
  updatedAt: "2026-02-27T..."
}
```

---

## 🚨 ERROR CODES & SOLUTIONS

| Code | Status | Çözüm |
|------|--------|-------|
| VALIDATION_ERROR | 400 | Form verilerini kontrol et |
| NOT_FOUND | 404 | ID'nin var olup olmadığını kontrol et |
| UNAUTHORIZED | 401 | Token kontrol et |
| FORBIDDEN | 403 | Permission kontrol et |
| CONFLICT | 409 | Çakışan veriyi kontrol et |
| INTERNAL_ERROR | 500 | Backend loglarını kontrol et |

---

## 💾 STORAGE

### Local Storage (Token/User)
```javascript
// Set
localStorage.setItem('token', token);
localStorage.setItem('userId', userId);

// Get
const token = localStorage.getItem('token');

// Remove
localStorage.removeItem('token');
```

---

## 🎨 STYLING QUICK REFERENCE

### Tailwind Classes Kullanımı
```javascript
// Colors
className="bg-blue-600 text-white"
className="bg-red-100 text-red-700"

// Spacing
className="p-4 mb-6"      // padding 16px, margin-bottom 24px
className="px-3 py-2"     // padding x 12px, y 8px

// Sizing
className="w-full h-8"    // width 100%, height 32px

// Flex
className="flex gap-2 items-center"

// Grid
className="grid grid-cols-3 gap-4"

// Responsive
className="grid grid-cols-1 lg:grid-cols-3"  // 1 col on mobile, 3 on large
```

---

## 📋 STATUS & PRIORITY OPTIONS

### Planning Status
- `draft` - Taslak
- `active` - Aktif
- `completed` - Tamamlandı
- `cancelled` - İptal

### Planning Priority
- `low` - Düşük
- `medium` - Orta
- `high` - Yüksek
- `critical` - Kritik

### Task Status
- `todo` - Yapılacak
- `in-progress` - Devam Ediyor
- `review` - Gözden Geçir
- `completed` - Tamamlandı

### Task Priority
- `low` - Düşük
- `medium` - Orta
- `high` - Yüksek
- `critical` - Kritik

---

## 📚 DOSYA REFERENCE'I

| Dosya | Amaç |
|-------|------|
| server.js | Express backend sunucusu |
| api-service.js | API client + custom hooks |
| planning-components.jsx | Reusable React components |
| PlanningPage.jsx | Ana planlama sayfası |
| SETUP_GUIDE.md | Detaylı kurulum rehberi |
| TROUBLESHOOTING.md | Sorun çözümleri |
| README.md | Proje özeti |
| backend-api-setup.md | API şeması ve modelleri |

---

## ⚡ PERFORMANCE TIPS

1. **Pagination Kullan**
   ```javascript
   await fetchPlannings({ skip: 0, limit: 10 });
   ```

2. **Conditional Rendering**
   ```javascript
   {isLoading ? <Spinner /> : <Content />}
   ```

3. **Memoization**
   ```javascript
   const MemoComponent = React.memo(Component);
   ```

4. **Lazy Loading**
   ```javascript
   const Component = lazy(() => import('./Component'));
   ```

---

## 🔐 SECURITY CHECKLIST

- [ ] HTTPS kullan (production)
- [ ] Token sakla (HttpOnly cookie)
- [ ] CORS whitelist tanımla
- [ ] Input validation yap
- [ ] Rate limiting ekle
- [ ] Error messages gösterme
- [ ] Sensitive data logla

---

## 🆘 QUICK HELP

```bash
# Backend status
curl http://localhost:5000/health

# Test planning create
curl -X POST http://localhost:5000/api/v1/planning \
  -H "Content-Type: application/json" \
  -d '{"title":"Test"}'

# Clear node_modules
rm -rf node_modules
npm install

# Change port
PORT=8080 npm run dev
```

---

**Hızlı Erişim:**
- Backend errors → browser console + backend terminal
- Frontend errors → browser DevTools console
- Network errors → Network tab
- State errors → React DevTools

**💡 Pro Tip:** Chrome DevTools'u açık tut (F12) development'da!

---

**Versiyon:** 1.0  
**Güncelleme:** 2026-02-27
