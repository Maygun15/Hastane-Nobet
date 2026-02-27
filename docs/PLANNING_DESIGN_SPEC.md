# 🏥 PLANLAMA EKRANI - TASARIM SPEC
## Hospital Roster Sistemine Entegre Edilmiş

---

## 📋 GENEL BAKIŞ

Hospital Roster'ın **"Planlamalar"** sekmesine eklenecek tam fonksiyonel planlama yönetim sistemi.

- 📊 Doktor/Hemşire nöbetlerini planlama
- 📅 Takvim + Timeline görünümleri
- 🔄 Çakışan saatleri algılama
- 🎯 Öncelik ve durum yönetimi

---

## 🎨 UI/UX YAPISI

### 1. HEADER BÖLÜMÜ

```
┌─────────────────────────────────────────────────────────────┐
│  [← Geri]  Planlama Yönetimi                  [+ Planlama] │
│                                                              │
│  📋 Liste  📅 Takvim  📊 Timeline                            │
│                                                              │
│  [🔍 Ara...]  [Durum ▼]  [Öncelik ▼]  [Personel ▼]         │
└─────────────────────────────────────────────────────────────┘
```

### 2. LAYOUT (2 KOLON)

```
┌──────────────────┬──────────────────────────────┐
│  SOL KOLON       │  SAĞ KOLON                   │
│  (Planlamalar)   │  (Detay + Görevler)         │
│                  │                              │
│  • Planlama 1    │  Seçili Planlama Detay      │
│  • Planlama 2    │  ┌─────────────────────┐    │
│  • Planlama 3    │  │ Başlık              │    │
│                  │  │ Durum + Öncelik     │    │
│                  │  │ Tarihler            │    │
│                  │  │ İlerleme %          │    │
│                  │  └─────────────────────┘    │
│                  │                              │
│                  │  Görevler Listesi           │
│                  │  ┌─────────────────────┐    │
│                  │  │ ☐ Görev 1           │    │
│                  │  │ ☑ Görev 2           │    │
│                  │  │ ☐ Görev 3           │    │
│                  │  └─────────────────────┘    │
└──────────────────┴──────────────────────────────┘
```

---

## 📊 VİEW MODLARI

### MODE 1: LİSTE GÖRÜNÜMÜ (DEFAULT)

**Planlama Kartı Tasarımı:**

```
┌─────────────────────────────────────┐
│ 🎯 Acil Nöbetler                    │ ← Başlık
│                                     │
│ Durum: [Aktif]  Öncelik: [Yüksek]  │ ← Badge'ler
│                                     │
│ 01.03.2026 - 31.03.2026            │ ← Tarih aralığı
│                                     │
│ İlerleme: ████░░░░ 40%             │ ← Progress bar
│                                     │
│ 12 Görev | 5 Tamamlandı | 7 Kaldı  │ ← İstatistikler
│                                     │
│ [Düzenle]  [Sil]                    │ ← Aksiyonlar
└─────────────────────────────────────┘
```

**Filtreleme Çubuku:**
- Arama (Title/Description)
- Status dropdown: "Tümü", "Taslak", "Aktif", "Tamamlandı", "İptal"
- Priority dropdown: "Tümü", "Düşük", "Orta", "Yüksek", "Kritik"
- Personel dropdown: "Tümü", "Dr. Ahmet", "Hemşire Ayşe", etc.
- Tarih aralığı: [Başlangıç] - [Bitiş]

---

### MODE 2: TAKVIM GÖRÜNÜMÜ

**Aylık takvim gridı:**

```
┌─────────────────────────────────────┐
│ ← Şubat 2026                      → │
├──────────────────────────────────────┤
│ Pt  Sa  Ça  Pe  Cu  Ct  Pz         │
├──────────────────────────────────────┤
│  1   2   3   4   5   6   7         │
│ [Plan] [Plan]                       │ ← Planlama göster
│                                     │
│  8   9  10  11  12  13  14        │
│            [Task]                   │ ← Görev göster
│                                     │
│ ... (diğer günler)                  │
└─────────────────────────────────────┘

Sidebar: Yaklaşan 5 Görev
- Acil Nöbetler (01.03)
- İcU Şifti (02.03)
- ...
```

---

### MODE 3: TIMELINE/GANTT GÖRÜNÜMÜ

```
Planlama Adı        Başlangıç    Bitiş    |████░░░░| %
─────────────────────────────────────────────────────
Acil Nöbetler       01.03       31.03    |████████| 100%
Ameliyathane        05.03       25.03    |█████░░░| 65%
Laboratuvar         10.03       30.03    |███░░░░░| 30%
```

---

## 🎯 PLANLAMA KARTININ DETAYLARI

### Kart Bileşenleri (Components):

**StatusBadge:**
- draft → Gri (Taslak)
- active → Mavi (Aktif)
- completed → Yeşil (Tamamlandı)
- cancelled → Kırmızı (İptal)

**PriorityBadge:**
- low → ▼ Yeşil (Düşük)
- medium → ● Sarı (Orta)
- high → ▲ Turuncu (Yüksek)
- critical → !!! Kırmızı (Kritik)

**ProgressBar:**
```
████████░░ 80% (8/10 tamamlandı)
```

---

## 📝 FORM MODALI (Planlama Oluştur/Düzenle)

```
┌─────────────────────────────────────┐
│ Yeni Planlama                       │
├─────────────────────────────────────┤
│                                     │
│ Başlık *                            │
│ [_________________________________] │
│ Gerekli alan                        │
│                                     │
│ Açıklama                            │
│ [_________________________________] │
│ [_________________________________] │
│                                     │
│ Başlangıç Tarihi *                 │
│ [2026-03-01]                        │
│                                     │
│ Bitiş Tarihi *                     │
│ [2026-03-31]                        │
│                                     │
│ Öncelik                             │
│ [Orta ▼]                            │
│                                     │
│ Durum                               │
│ [Aktif ▼]                           │
│                                     │
│ Atanan Personel (çoklu seçim)       │
│ ☐ Dr. Ahmet                         │
│ ☐ Hemşire Ayşe                      │
│ ☐ Teknisyen Ali                     │
│                                     │
│ [Kaydet]  [İptal]                   │
└─────────────────────────────────────┘
```

---

## ✅ GÖREV MODALI (Task Form)

```
┌─────────────────────────────────────┐
│ Yeni Görev                          │
├─────────────────────────────────────┤
│                                     │
│ Görev Başlığı *                    │
│ [_________________________________] │
│                                     │
│ Açıklama                            │
│ [_________________________________] │
│                                     │
│ Başlangıç Tarihi *                 │
│ [2026-03-01]                        │
│                                     │
│ Bitiş Tarihi *                     │
│ [2026-03-05]                        │
│                                     │
│ Durum                               │
│ ☐ Yapılacak ☐ Devam Ediyor        │
│ ☐ Gözden Geçir ☐ Tamamlandı       │
│                                     │
│ Öncelik                             │
│ [Orta ▼]                            │
│                                     │
│ Tahmini Saat                        │
│ [8.5]                               │
│                                     │
│ Atanan Kişi                         │
│ [Dr. Ahmet ▼]                       │
│                                     │
│ [Kaydet]  [İptal]                   │
└─────────────────────────────────────┘
```

---

## 🔄 STATE YÖNETIMI

### Component States:

```javascript
{
  // View State
  view: 'list' | 'calendar' | 'timeline',
  
  // Selection State
  selectedPlanning: Planning | null,
  selectedTask: Task | null,
  
  // Modal States
  showPlanningForm: boolean,
  showTaskForm: boolean,
  editingPlanning: Planning | null,
  editingTask: Task | null,
  
  // Filter States
  filters: {
    search: string,
    status: string,
    priority: string,
    personnel: string,
    dateFrom: Date,
    dateTo: Date
  },
  
  // Data States
  plannings: Planning[],
  tasks: Task[],
  
  // UI States
  loading: boolean,
  error: Error | null,
  toast: { message, type, duration }
}
```

---

## 📊 DATA MODELS

### Planning Object

```javascript
{
  _id: "123abc",
  title: "Acil Nöbetleri",
  description: "Acil servisi nöbetleri",
  
  // Tarihler
  startDate: "2026-03-01",
  endDate: "2026-03-31",
  
  // Durumlar
  status: "active",        // draft, active, completed, cancelled
  priority: "high",        // low, medium, high, critical
  
  // Personel
  assignedPersonnel: ["123", "456"], // User IDs
  
  // Görevler
  tasks: ["task1", "task2"],
  
  // Metadata
  metadata: {
    totalTasks: 10,
    completedTasks: 4,
    progress: 40,
    estimatedHours: 80,
    actualHours: 32,
    conflicts: ["task3", "task5"] // Çakışan görevler
  },
  
  // Timestamps
  createdAt: "2026-02-27T10:00:00Z",
  updatedAt: "2026-02-27T14:30:00Z",
  createdBy: "user123"
}
```

### Task Object

```javascript
{
  _id: "task123",
  planningId: "123abc",
  
  // Temel Bilgiler
  title: "Sağlık Taraması",
  description: "Tüm personel sağlık taraması",
  
  // Tarihler
  startDate: "2026-03-01",
  dueDate: "2026-03-05",
  completedDate: null,
  
  // Durumlar
  status: "in-progress",   // todo, in-progress, review, completed
  priority: "high",        // low, medium, high, critical
  
  // Saatler
  estimatedHours: 8.5,
  actualHours: 5.0,
  
  // Atama
  assignedTo: "user123",
  assignedToName: "Dr. Ahmet",
  
  // Bağımlılıklar
  dependencies: ["task2", "task4"],
  
  // Alt Görevler
  subtasks: [
    { id: "sub1", title: "Doktor Sağlık Taraması", completed: true },
    { id: "sub2", title: "Hemşire Sağlık Taraması", completed: false }
  ],
  
  // Çakışma Kontrolü
  hasConflict: false,
  conflictWith: [],
  
  // Timestamps
  createdAt: "2026-02-27T10:00:00Z",
  updatedAt: "2026-02-27T14:30:00Z"
}
```

---

## 🔌 API ENDPOINTS

### Planning Endpoints

```
GET    /api/schedules/plannings
       Query: ?status=active&priority=high&dateFrom=2026-03-01
       Response: { plannings: [], total: 50 }

POST   /api/schedules/plannings
       Body: { title, description, startDate, endDate, priority, status }
       Response: { _id, ...planning }

GET    /api/schedules/plannings/:id
       Response: { ...planning, tasks: [] }

PUT    /api/schedules/plannings/:id
       Body: { title, description, status, priority, ... }
       Response: { ...updated }

DELETE /api/schedules/plannings/:id
       Response: { success: true }
```

### Task Endpoints

```
GET    /api/schedules/tasks?planningId=123
       Response: { tasks: [], total: 10 }

POST   /api/schedules/tasks
       Body: { planningId, title, startDate, dueDate, priority, estimatedHours }
       Response: { _id, ...task }

GET    /api/schedules/tasks/:id
       Response: { ...task }

PUT    /api/schedules/tasks/:id
       Body: { title, status, priority, ... }
       Response: { ...updated }

PATCH  /api/schedules/tasks/:id/status
       Body: { status: "completed" }
       Response: { ...updated }

DELETE /api/schedules/tasks/:id
       Response: { success: true }

POST   /api/schedules/tasks/check-conflicts
       Body: { planningId, startDate, endDate, assignedTo }
       Response: { conflicts: [], hasConflict: boolean }
```

---

## 🔄 INTERACTION FLOWS

### 1. Planlama Oluşturma Akışı

```
User clicks "+ Planlama" 
    ↓
PlanningForm Modal açılır
    ↓
Form doldurulur
    ↓
Kaydet butonuna tıklanır
    ↓
Frontend Validation (Client-side)
    ↓
API POST /api/schedules/plannings
    ↓
Backend Validation + Database Save
    ↓
Success Response
    ↓
State Update: plannings array
    ↓
UI Re-render
    ↓
Toast Message: "Planlama oluşturuldu"
    ↓
Form Modal kapanır
```

### 2. Görev Ekleme Akışı

```
User selects Planning
    ↓
Planning detay gösterilir
    ↓
User clicks "+ Görev Ekle"
    ↓
TaskForm Modal açılır (planningId pre-filled)
    ↓
Form doldurulur
    ↓
Check Conflicts API call
    ↓
Eğer çakışma varsa: Warning göster
    ↓
Kaydet butonuna tıklanır
    ↓
API POST /api/schedules/tasks
    ↓
Task eklenir, Planning refresh edilir
    ↓
Progress % güncelleir
    ↓
Task listesi yeniden render edilir
```

### 3. Filtreleme Akışı

```
User changes filter (Search/Status/Priority)
    ↓
debounce(300ms)
    ↓
API GET /api/schedules/plannings?filters...
    ↓
Results filtered on backend
    ↓
UI updates with filtered plannings
    ↓
No animation lag (optimized)
```

---

## 🎨 COLOR SCHEME & STYLING

### Status Colors
- **Draft** → `#9CA3AF` (Gray)
- **Active** → `#3B82F6` (Blue)
- **Completed** → `#10B981` (Green)
- **Cancelled** → `#EF4444` (Red)

### Priority Colors
- **Low** → `#10B981` (Green)
- **Medium** → `#F59E0B` (Yellow)
- **High** → `#F97316` (Orange)
- **Critical** → `#DC2626` (Red)

### UI Elements
- Background: `#F9FAFB` (Light Gray)
- Cards: `#FFFFFF` (White)
- Borders: `#E5E7EB` (Gray-200)
- Primary Button: `#3B82F6` (Blue)
- Hover: Slight shadow + darker color

---

## ⚡ PERFORMANCE REQUIREMENTS

### Loading Times
- Initial load: < 2 seconds
- Filter/Search: < 500ms
- Modal open/close: Instant (< 100ms)
- List scroll: Smooth (60 FPS)

### Optimizations
- Pagination: 10-20 items per page
- Virtual scrolling for long lists
- Debounced search (300ms)
- Memoized components
- Lazy loading for modals

---

## 🔐 VALIDATION RULES

### Planning Form Validation
```
✓ title: Required, min 3 chars, max 100 chars
✓ startDate: Required, must be valid date
✓ endDate: Required, must be > startDate
✓ priority: Required, enum (low, medium, high, critical)
✓ status: enum (draft, active, completed, cancelled)
✓ description: Optional, max 500 chars
```

### Task Form Validation
```
✓ title: Required, min 3 chars, max 100 chars
✓ planningId: Required, must exist
✓ startDate: Required, must be > planning.startDate
✓ dueDate: Required, must be < planning.endDate
✓ estimatedHours: Optional, must be > 0
✓ priority: enum
✓ status: enum
✓ assignedTo: Required, must be valid user ID
```

---

## 📱 RESPONSIVE DESIGN

### Desktop (1200px+)
- 2 kolon layout (Sol: Planlamalar, Sağ: Detay)
- Full grid calendar
- Full timeline view

### Tablet (768px - 1199px)
- Stacked layout veya collapsible sidebar
- Responsive cards
- Horizontal scroll for timeline

### Mobile (< 768px)
- Single column
- Tab-based navigation
- Card-based layout
- Simplified forms

---

## 🔔 TOAST NOTIFICATIONS

**Success Messages:**
- "Planlama başarıyla oluşturuldu ✓"
- "Görev tamamlandı ✓"
- "Değişiklikler kaydedildi ✓"

**Error Messages:**
- "Tarih aralığında çakışma tespit edildi"
- "Lütfen tüm gerekli alanları doldurun"
- "Sunucu hatası oluştu, lütfen tekrar deneyin"

**Warning Messages:**
- "Bu görevde 3 çakışma var - devam etmek istiyor musunuz?"

**Duration:** 4 seconds (error: 6 seconds)

---

## 🧪 TESTING CHECKLIST

- [ ] Planlama oluştur / Düzenle / Sil
- [ ] Görev ekle / Güncelle / Sil
- [ ] Durum değiştir (Todo → Completed)
- [ ] Filtreleme (Search, Status, Priority)
- [ ] Görünüm değiştir (List → Calendar → Timeline)
- [ ] Çakışma algılama
- [ ] Form validation
- [ ] API error handling
- [ ] Loading states
- [ ] Toast notifications
- [ ] Responsive design (Desktop, Tablet, Mobile)

---

## 📝 NOTES FOR DEVELOPER

1. **Codex'e ver tamamını** - Bunu direk copy-paste yapabilirsin
2. **Dosya adları:** SchedulesPlanning.jsx, PlanningForm.jsx, vb
3. **Styling:** TailwindCSS kullanılacak
4. **State:** React Hooks (useState, useEffect, useCallback)
5. **API calls:** Hospital Roster'ın mevcut API structure'ına uyacak
6. **Error handling:** Consistent error messages + retry logic
7. **Database:** Hospital Roster'ın mevcut DB schema'sına entegre
8. **Git:** Feature branch'te çalış (planning/master-feature)

---

**Bu spec'i direkt Codex'e kopyala-yapıştır yapabilirsin!**

Eksik olan noktaları sonra yazarsın bana, geliştiririm. 🚀
