# 🚀 CODEX IMPLEMENTATION GUIDE
## Hospital Roster - Planlama Ekranı

---

## 📌 BAŞLAMADAN ÖNCE

Bu tasarım spec'i direkt Codex'e (Claude Code) vereceksin:

```
"Hospital Roster uygulamasında Planlama Ekranı eklemek istiyorum.
Spec dosyası gönderiyorum, lütfen implementasyon yap."
```

---

## 📁 DOSYA YAPISI (OLUŞTURULACAK)

```
hospital-roster/
├── src/
│   ├── pages/
│   │   └── SchedulesPlanning/
│   │       ├── SchedulesPlanning.jsx      ← Ana konteyner
│   │       ├── PlanningCard.jsx           ← Planlama kartı
│   │       ├── PlanningForm.jsx           ← Form modal
│   │       ├── TaskForm.jsx               ← Task modal
│   │       ├── TaskItem.jsx               ← Task satırı
│   │       ├── TaskList.jsx               ← Task listesi
│   │       ├── CalendarView.jsx           ← Takvim görünümü
│   │       ├── TimelineView.jsx           ← Timeline görünümü
│   │       ├── FilterBar.jsx              ← Filtre çubuku
│   │       ├── StatusBadge.jsx            ← Status badge
│   │       ├── PriorityBadge.jsx          ← Priority badge
│   │       ├── ProgressBar.jsx            ← Progress göstergesi
│   │       └── useSchedulePlanning.js     ← Custom hook
│   │
│   ├── services/
│   │   └── scheduleApi.js                 ← API çağrıları
│   │
│   ├── hooks/
│   │   ├── useSchedules.js                ← Schedule hook
│   │   ├── useTasks.js                    ← Task hook
│   │   └── useFilters.js                  ← Filter hook
│   │
│   └── utils/
│       ├── dateUtils.js                   ← Tarih işlemleri
│       ├── conflictDetection.js           ← Çakışma algılama
│       └── validators.js                  ← Form validation
│
├── api/
│   └── schedules.js                       ← Backend routes
│
└── models/
    └── Schedule.js                        ← Mongoose model (if MongoDB)
```

---

## 🎯 ADIM ADIM IMPLEMENTATION

### STEP 1: Ana Konteyner (SchedulesPlanning.jsx)

**Requirements:**
- 3 view mode (list, calendar, timeline)
- Left panel: Planning cards
- Right panel: Details + Tasks
- Top bar: Filters + View toggle
- Modal management (form visibility)

**Key State Variables:**
```javascript
const [view, setView] = useState('list');
const [selectedPlanning, setSelectedPlanning] = useState(null);
const [showPlanningForm, setShowPlanningForm] = useState(false);
const [showTaskForm, setShowTaskForm] = useState(false);
const [filters, setFilters] = useState({
  search: '',
  status: 'all',
  priority: 'all',
  personnel: 'all'
});
```

**API Calls:**
- `GET /api/schedules/plannings` - Planlamaları yükle
- `GET /api/schedules/tasks?planningId=X` - Görevleri yükle

---

### STEP 2: Planlama Kartı (PlanningCard.jsx)

**Props:**
```javascript
{
  planning: {
    _id, title, description, startDate, endDate,
    status, priority, tasks, metadata
  },
  isSelected: boolean,
  onClick: () => void,
  onEdit: () => void,
  onDelete: () => void
}
```

**Features:**
- Badge'ler (Status + Priority)
- Progress bar
- İstatistikler (X görev, Y tamamlandı)
- Hover effect
- Action buttons

---

### STEP 3: Planlama Formu (PlanningForm.jsx)

**Fields:**
```javascript
{
  title: string (required),
  description: string,
  startDate: date (required),
  endDate: date (required),
  priority: enum (required),
  status: enum (required),
  assignedPersonnel: array (multi-select)
}
```

**Validation:**
- Title: 3-100 chars
- Dates: startDate < endDate
- Required fields validation

**Error Display:**
- Field-level error messages
- Toast notification on success/failure

---

### STEP 4: Görev Formu (TaskForm.jsx)

**Fields:**
```javascript
{
  planningId: string (pre-filled),
  title: string (required),
  startDate: date (required),
  dueDate: date (required),
  estimatedHours: number,
  priority: enum,
  status: enum,
  assignedTo: string (user select)
}
```

**Special Features:**
- Check conflicts API call before submit
- Warning if conflicts found
- Subtask support (optional UI)

---

### STEP 5: Görev Listesi (TaskList.jsx)

**Features:**
- Checkbox to toggle completion
- Drag & drop reorder (optional)
- Inline status change
- Edit/Delete actions
- Styled by status/priority

---

### STEP 6: Takvim Görünümü (CalendarView.jsx)

**Features:**
- Monthly calendar grid
- Event dots on dates
- Click to see details
- Navigation (prev/next month)
- Sidebar: Upcoming tasks

**Library:** React-Calendar or custom implementation

---

### STEP 7: Timeline Görünümü (TimelineView.jsx)

**Features:**
- Gantt-chart style bars
- Progress percentage
- Date range per planning
- Scrollable horizontally
- Responsive layout

---

### STEP 8: Custom Hook (useSchedulePlanning.js)

```javascript
export const useSchedulePlanning = () => {
  const [plannings, setPlannings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPlannings = useCallback(async (filters) => {
    // API call
  }, []);

  const createPlanning = useCallback(async (data) => {
    // POST API call
  }, []);

  const updateTaskStatus = useCallback(async (taskId, status) => {
    // PATCH API call
  }, []);

  // ... more methods

  return { plannings, tasks, loading, error, fetchPlannings, ... };
};
```

---

## 🔧 API INTEGRATION POINTS

### Existing Hospital Roster API'ye Uyum

**Check these endpoints first:**
```
GET /api/schedules
GET /api/schedules/:id
POST /api/schedules
PUT /api/schedules/:id
DELETE /api/schedules/:id

GET /api/personnel (doktor/hemşire listesi için)
GET /api/departments (departman listesi için)
```

**New endpoints to create:**
```
GET /api/schedules/plannings
POST /api/schedules/plannings
GET /api/schedules/tasks
POST /api/schedules/tasks
PATCH /api/schedules/tasks/:id/status
POST /api/schedules/tasks/check-conflicts
```

---

## 🎨 STYLING GUIDELINES

### TailwindCSS Classes

**Containers:**
```jsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {/* Left panel: lg:col-span-1 */}
  {/* Right panel: lg:col-span-2 */}
</div>
```

**Cards:**
```jsx
<div className="bg-white rounded-lg border border-gray-200 p-4 shadow hover:shadow-md">
```

**Buttons:**
```jsx
// Primary
<button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
// Secondary
<button className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
```

**Badges:**
```jsx
<span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
```

---

## 📊 STATE MANAGEMENT APPROACH

### Option 1: React Hooks + Context
- Simple, built-in
- Good for medium complexity
- No external library

### Option 2: Redux
- If already using in Hospital Roster
- Better for complex state
- Scalable

### Recommendation:
**Start with Hooks + Context**, migrate to Redux if needed.

---

## 🔄 ERROR HANDLING PATTERN

```javascript
try {
  const result = await createPlanning(data);
  if (result.success) {
    showToast('Başarılı', 'success');
    refreshList();
  } else {
    showToast(result.error.message, 'error');
  }
} catch (error) {
  if (error.response?.status === 400) {
    // Validation error - show field errors
    setFieldErrors(error.response.data.details);
  } else {
    // Network or server error
    showToast('Bir hata oluştu. Lütfen tekrar deneyin.', 'error');
  }
}
```

---

## ✅ FORM VALIDATION PATTERN

```javascript
const validateForm = (data) => {
  const errors = {};

  if (!data.title?.trim()) {
    errors.title = 'Başlık gereklidir';
  } else if (data.title.length < 3) {
    errors.title = 'Başlık minimum 3 karakter olmalıdır';
  }

  if (new Date(data.startDate) > new Date(data.endDate)) {
    errors.dates = 'Başlangıç tarihi bitiş tarihinden önce olmalıdır';
  }

  return errors;
};
```

---

## 🔌 TOAST NOTIFICATION IMPLEMENTATION

```javascript
const [toast, setToast] = useState(null);

const showToast = (message, type = 'info', duration = 4000) => {
  setToast({ message, type });
  setTimeout(() => setToast(null), duration);
};

// Usage
showToast('Planlama oluşturuldu', 'success');
showToast('Hata oluştu', 'error');
```

---

## 🧪 TESTING SCENARIOS

### Test 1: Create Planning
```
1. Click "+ Planlama"
2. Fill form (title, dates, priority)
3. Click "Kaydet"
4. Verify: Planning added to list, API called
5. Check: Toast message shown
```

### Test 2: Filter Planning
```
1. Type in search box
2. Select status filter
3. Verify: List filtered on backend
4. Check: No UI lag
```

### Test 3: Change Task Status
```
1. Click checkbox on task
2. Task marked as completed
3. Verify: API PATCH called
4. Check: Progress bar updated
```

### Test 4: Check Conflicts
```
1. Create task in same time period
2. System detects conflict
3. Warning shown to user
4. Verify: User can proceed or cancel
```

---

## 🚀 DEPLOYMENT CHECKLIST

- [ ] All endpoints tested with curl/Postman
- [ ] Form validation working (Client + Server)
- [ ] Error messages clear and helpful
- [ ] Loading states visible
- [ ] Toast notifications working
- [ ] Responsive design tested (Desktop, Tablet, Mobile)
- [ ] No console errors/warnings
- [ ] API calls efficient (no N+1 queries)
- [ ] Performance: <2s initial load, <500ms filters
- [ ] Git: Clean commits, no debugging code

---

## 💡 CODEX PROMPTS (Codex'e ne yazacaksın)

### Prompt 1: Main Container
```
"Create SchedulesPlanning.jsx component.
It should:
- Have 3 views: list, calendar, timeline
- 2-column layout (left: planning cards, right: details)
- Top filters: search, status, priority, personnel
- Modals for create/edit planning and tasks
- Toast notifications
- Use the spec provided

Use React hooks for state management.
Include error handling and loading states."
```

### Prompt 2: Components
```
"Create these components:
1. PlanningCard.jsx - With badges, progress, actions
2. PlanningForm.jsx - With form validation
3. TaskForm.jsx - With conflict checking
4. CalendarView.jsx - Monthly calendar
5. TimelineView.jsx - Gantt chart

Use TailwindCSS for styling.
Props interfaces should match the spec."
```

### Prompt 3: API Integration
```
"Create scheduleApi.js service with:
- GET /api/schedules/plannings
- POST /api/schedules/plannings
- GET /api/schedules/tasks
- POST /api/schedules/tasks
- PATCH /api/schedules/tasks/:id/status
- POST /api/schedules/tasks/check-conflicts

Include error handling and request logging."
```

### Prompt 4: Custom Hook
```
"Create useSchedulePlanning hook that:
- Manages plannings and tasks state
- Handles CRUD operations
- Filters and pagination
- Error handling
- Loading states

Export: { plannings, tasks, loading, error, methods... }"
```

---

## 🔗 INTEGRATION WITH EXISTING HOSPITAL ROSTER

### Check These Files First:
1. **src/pages/** - Mevcut page yapısı
2. **src/services/** - API call patterns
3. **src/hooks/** - Mevcut hooks
4. **tailwind.config.js** - Styling config
5. **package.json** - Dependencies

### Compatibility:
- React version: Check package.json
- Node version: Check .nvmrc
- Build tool: Webpack/Vite?
- State management: Redux/Context/Hooks?
- UI library: Material-UI/Tailwind/Custom?

---

## 📝 COMMUNICATION WITH CODEX

1. **Start:** Share this entire guide to Codex
2. **Chunks:** If large, split into smaller prompts
3. **Feedback:** Show Codex any errors/issues
4. **Iterate:** "Update this component to..."
5. **Test:** Ask Codex to create test cases

**Example flow:**
```
You: "Here's the spec. Create SchedulesPlanning.jsx"
Codex: [Generates code]
You: "Add dark mode support"
Codex: [Updates code]
You: "Fix this error: [error message]"
Codex: [Fixes issue]
```

---

## 🎯 SUCCESS METRICS

When implementation is complete, verify:

- ✅ All 3 views working (List, Calendar, Timeline)
- ✅ CRUD operations working (Create, Read, Update, Delete)
- ✅ Filters working (Search, Status, Priority)
- ✅ Conflict detection working
- ✅ Form validation working
- ✅ Error handling working
- ✅ Toast notifications working
- ✅ Responsive design working
- ✅ No console errors
- ✅ Performance acceptable

---

## 📞 IF STUCK

**Common Issues & Solutions:**

1. **API not found (404)**
   - Check endpoint path matches backend
   - Verify URL in .env
   - Check backend is running

2. **State not updating**
   - Verify setState called after API response
   - Check dependency arrays in useEffect
   - Use React DevTools to debug

3. **Styling issues**
   - Check TailwindCSS is configured
   - Verify class names are valid
   - Check z-index for modals

4. **Form validation not working**
   - Check error state update
   - Verify validation function logic
   - Test with console.log

---

## 🎓 LEARNING RESOURCES

If you or Codex need help:
- React Hooks: https://react.dev/reference/react
- TailwindCSS: https://tailwindcss.com/docs
- Date handling: https://date-fns.org/
- Form validation: Custom or Formik/React Hook Form

---

**Ready to share with Codex? Copy this entire file and paste it to Codex.** 🚀

Good luck! Ask me if you need clarifications on the spec. 💪
