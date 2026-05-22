/**
 * src/config/menuConfig.js
 *
 * Uygulamanın tek navigasyon kaynağı (single source of truth).
 * HospitalRosterApp.jsx içindeki inline sidebar buradan beslenir.
 *
 * Yapı:
 *   MENU_CONFIG → array of Group
 *   Group       → { type:'group', id, label, collapsible, visibleTo, children }
 *   Branch      → { type:'branch', id, label, path, icon, visibleTo, children }
 *   Leaf        → { type:'leaf', id (= tabId), label, path, icon, visibleTo }
 *   Action      → { type:'action', id, label, icon, action, visibleTo }
 *
 * Roller:
 *   'admin'      → tam yetki
 *   'manager'    → yönetici (isAuthorized kapsamında)
 *   'authorized' → yetkili kullanıcı
 *   'staff'      → personel (isAuthorized kapsamında)
 *   'user'       → temel kullanıcı (basicUser)
 *
 * path kuralı:
 *   '/...'  → pushState (pathname)
 *   '#/...' → window.location.hash
 *   null    → action/modal, URL yoktur
 */

// ── Rol kümeleri (visibleTo kısaltmaları) ─────────────────────────────────────
export const R_ADMIN      = ['admin'];
export const R_ADMIN_MGR  = ['admin', 'manager'];
export const R_PRIVILEGED = ['admin', 'manager', 'authorized', 'staff'];
export const R_ALL        = ['admin', 'manager', 'authorized', 'staff', 'user'];
export const R_BASIC      = ['user']; // sadece basicUser (admin/authorized değil)

// ── Menü ağacı ────────────────────────────────────────────────────────────────
export const MENU_CONFIG = [

  // ══════════════════════════════════════════════════════════════════
  // GRUP 1 — Operasyon
  // Herkese açık temel iş akışları
  // ══════════════════════════════════════════════════════════════════
  {
    type: 'group',
    id: 'operasyon',
    label: 'Operasyon',
    collapsible: false,
    visibleTo: R_ALL,
    children: [

      {
        type: 'leaf',
        id: 'plan',
        label: 'Planlama',
        labelAlt: 'Takvimim', // basicUser'a gösterilen ad
        path: '/',
        icon: 'LayoutDashboard',
        visibleTo: R_ALL,
      },

      // basicUser-only: yalnızca temel kullanıcılar görür
      {
        type: 'leaf',
        id: 'announcements',
        label: 'Duyurular',
        path: '/duyurular',
        icon: 'Bell',
        visibleTo: R_BASIC,
      },
      {
        type: 'leaf',
        id: 'myRequests',
        label: 'Taleplerim',
        path: '/isteklerim',
        icon: 'ClipboardList',
        visibleTo: R_BASIC,
      },

      // Personel: dinamik alt-bölümler (personnelSections localStorage'dan gelir;
      // bu liste varsayılan değerdir — Sidebar bileşeni bunu LS ile merge eder)
      {
        type: 'branch',
        id: 'personnel',
        label: 'Personel',
        path: '/personel',
        icon: 'Users2',
        visibleTo: R_PRIVILEGED,
        children: [
          {
            type: 'leaf',
            id: 'personnel:hemsireler',
            label: 'Hemşireler',
            path: '/personel?sec=hemsireler',
            visibleTo: R_PRIVILEGED,
          },
          {
            type: 'leaf',
            id: 'personnel:doktorlar',
            label: 'Doktorlar',
            path: '/personel?sec=doktorlar',
            visibleTo: R_PRIVILEGED,
          },
        ],
      },

      // Çizelgeler: 4 sabit alt-bölüm
      {
        type: 'branch',
        id: 'schedules',
        label: 'Çizelgeler',
        path: '#/cizelgeler',
        icon: 'CalendarDays',
        visibleTo: R_PRIVILEGED,
        children: [
          {
            type: 'leaf',
            id: 'schedules:calisma-cizelgesi',
            label: 'Çalışma Çizelgesi',
            path: '#/cizelgeler/calisma-cizelgesi',
            visibleTo: R_PRIVILEGED,
          },
          {
            type: 'leaf',
            id: 'schedules:aylik',
            label: 'Aylık Çalışma ve Mesai',
            path: '#/cizelgeler/aylik-calisma-ve-mesai-saatleri-cizelgesi',
            visibleTo: R_PRIVILEGED,
          },
          {
            type: 'leaf',
            id: 'schedules:fazla-mesai',
            label: 'Fazla Mesai Takip',
            path: '#/cizelgeler/fazla-mesai-takip',
            visibleTo: R_PRIVILEGED,
          },
          {
            type: 'leaf',
            id: 'schedules:toplu-izin',
            label: 'Toplu İzin Listesi',
            path: '#/cizelgeler/toplu-izin-listesi',
            visibleTo: R_PRIVILEGED,
          },
        ],
      },

    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // GRUP 2 — Yönetim
  // Admin + yetkili işlemler (collapsible)
  // ══════════════════════════════════════════════════════════════════
  {
    type: 'group',
    id: 'yonetim',
    label: 'Yönetim',
    collapsible: true,
    visibleTo: R_PRIVILEGED,
    children: [

      // Parametreler: 9 alt-sekme (nobet-yazma-kurallari EKLENDI, calisma-saatleri YENİDEN ADLANDIRILDI)
      {
        type: 'branch',
        id: 'parameters',
        label: 'Parametreler',
        path: '#/parametreler',
        icon: 'Settings2',
        visibleTo: R_ADMIN,
        children: [
          {
            type: 'leaf',
            id: 'parameters:calisma-alanlari',
            label: 'Çalışma Alanları',
            path: '#/parametreler/calisma-alanlari',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:calisma-saatleri',
            // ⚠ İSİM DEĞİŞİKLİĞİ: "Çalışma Saatleri" → "Vardiya Tanımları"
            // Raporlar grubundaki "Çalışma Saatleri Özeti" ile karışıklık giderildi.
            label: 'Vardiya Tanımları',
            path: '#/parametreler/calisma-saatleri',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:izin-turleri',
            label: 'İzin Türleri',
            path: '#/parametreler/izin-turleri',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:servisler',
            label: 'Servisler',
            path: '#/parametreler/servisler',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:tatil-takvimi',
            label: 'Tatil Takvimi',
            path: '#/parametreler/tatil-takvimi',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:nobet-kurallari',
            label: 'Nöbet Kuralları',
            path: '#/parametreler/nobet-kurallari',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:nobet-yazma-kurallari',
            // ⚠ YENİ: Sidebar'da gizliydi; şimdi görünür olarak eklendi.
            label: 'Nöbet Yazma Kuralları',
            path: '#/parametreler/nobet-yazma-kurallari',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:cizelge-yapisi',
            label: 'Çizelge Yapısı',
            path: '#/parametreler/cizelge-yapisi',
            visibleTo: R_ADMIN,
          },
          {
            type: 'leaf',
            id: 'parameters:istek',
            label: 'İstek Yönetimi',
            path: '#/parametreler/istek',
            visibleTo: R_ADMIN,
          },
        ],
      },

      {
        type: 'leaf',
        id: 'users',
        label: 'Kullanıcılar',
        path: '/kullanicilar',
        icon: 'UserRound',
        visibleTo: R_ADMIN,
      },
      {
        type: 'leaf',
        id: 'auditlog',
        label: 'İşlem Günlüğü',
        path: '/islem-gunlugu',
        icon: 'FileText',
        visibleTo: R_ADMIN,
      },
      {
        type: 'leaf',
        id: 'plannings',
        label: 'Planlama Yönetimi',
        path: '#/yonetim/planlama',
        icon: 'CalendarCog',
        visibleTo: R_ADMIN,
      },

      // Action: tab değil, modal açar
      {
        type: 'action',
        id: 'announcement-modal',
        label: 'Duyuru Gönder',
        path: null,
        icon: 'Megaphone',
        action: 'openAnnouncementModal',
        visibleTo: R_ADMIN_MGR,
      },

    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // GRUP 3 — Raporlar
  // Yönetim grubundan bağımsız ayrı bir rapor bölümü
  // ══════════════════════════════════════════════════════════════════
  {
    type: 'group',
    id: 'raporlar',
    label: 'Raporlar',
    collapsible: true,
    visibleTo: R_ADMIN,
    children: [

      {
        type: 'leaf',
        id: 'occupancyReport',
        label: 'Doluluk Raporu',
        path: '#/reports/occupancy',
        icon: 'BarChart2',
        visibleTo: R_ADMIN,
      },
      {
        type: 'leaf',
        id: 'leaveBalance',
        label: 'İzin Bakiyesi',
        path: '#/reports/leave-balance',
        icon: 'CalendarCheck',
        visibleTo: R_ADMIN,
      },
      {
        type: 'leaf',
        id: 'workingHoursSummary',
        // ⚠ İSİM DEĞİŞİKLİĞİ: "Çalışma Saatleri" → "Çalışma Saatleri Özeti"
        // Parametreler altındaki "Vardiya Tanımları" ile karışıklık giderildi.
        label: 'Çalışma Saatleri Özeti',
        path: '#/reports/working-hours',
        icon: 'Clock4',
        visibleTo: R_ADMIN,
      },
      {
        type: 'leaf',
        id: 'leaveStats',
        label: 'İzin İstatistikleri',
        path: '#/reports/leave-stats',
        icon: 'BarChart',
        visibleTo: R_ADMIN,
      },

    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // GRUP 4 — Analiz
  // Önceden gizli olan dashboard/aiScheduler/aiCost buraya taşındı.
  // ══════════════════════════════════════════════════════════════════
  {
    type: 'group',
    id: 'analiz',
    label: 'Analiz',
    collapsible: true,
    visibleTo: R_PRIVILEGED,
    children: [

      {
        type: 'leaf',
        id: 'fairness',
        label: 'Adillik Raporu',
        path: '#/analiz/adillik',
        icon: 'Scale',
        visibleTo: R_PRIVILEGED,
      },
      {
        type: 'leaf',
        id: 'dashboard',
        // ⚠ DÜZELTME: openDashboard() vardı ama sidebar butonu yoktu.
        label: 'Genel Bakış',
        path: '#/analiz/genel-bakis',
        icon: 'PieChart',
        visibleTo: R_PRIVILEGED,
      },
      {
        type: 'leaf',
        id: 'aiScheduler',
        // ⚠ DÜZELTME: navOrder'da vardı, sidebar'da yoktu.
        label: 'AI Çizelge',
        path: '#/analiz/ai-cizelge',
        icon: 'CalendarClock',
        visibleTo: R_PRIVILEGED,
      },
      {
        type: 'leaf',
        id: 'aiCost',
        // ⚠ DÜZELTME: navOrder'da vardı, sidebar'da yoktu.
        label: 'AI Maliyet',
        path: '#/analiz/ai-maliyet',
        icon: 'CircleDollarSign',
        visibleTo: R_ADMIN,
      },

    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // HIZLI KISA YOLLAR (sidebar dışı — header bar'da render edilir)
  // Bu gruptaki öğeler sidebar'a değil, üst toolbar'a yansır.
  // ══════════════════════════════════════════════════════════════════
  {
    type: 'group',
    id: 'quick-actions',
    label: 'Hızlı Kısayollar',
    collapsible: false,
    isQuickAction: true, // Sidebar render etmez, header toolbar render eder
    visibleTo: R_ALL,
    children: [

      {
        type: 'leaf',
        id: 'ai',
        label: 'AI Asistan',
        path: null, // setActiveTab('ai') ile açılır, URL yok
        icon: 'Bot',
        visibleTo: R_PRIVILEGED,
      },
      {
        type: 'leaf',
        id: 'requests',
        // ⚠ Çift hedef: admin/staff → 'requests', user → 'myRequests'
        // Sidebar bileşeni kullanıcı rolüne göre doğru tab'ı seçer.
        label: 'Talepler',
        path: '/talepler',
        icon: 'ClipboardList',
        visibleTo: R_ALL,
      },
      {
        type: 'leaf',
        id: 'profile',
        label: 'Profilim',
        path: '/profilim',
        icon: 'UserRound',
        visibleTo: R_ALL,
      },

    ],
  },

];

// ── Yardımcı: tab ID'den menü öğesi bul ──────────────────────────────────────
export function findMenuItemByTabId(tabId) {
  for (const group of MENU_CONFIG) {
    for (const item of group.children || []) {
      if (item.id === tabId) return item;
      for (const child of item.children || []) {
        if (child.id === tabId) return child;
      }
    }
  }
  return null;
}

// ── Yardımcı: path'ten tab ID bul (URL sync için) ────────────────────────────
export function resolveTabIdFromPath(pathname, hash) {
  const fullHash = (hash || '').replace(/^#/, '');
  for (const group of MENU_CONFIG) {
    for (const item of group.children || []) {
      if (item.path) {
        const p = item.path.startsWith('#/') ? item.path.slice(2) : item.path;
        if (fullHash.startsWith(p) || pathname.startsWith(p)) return item.id;
      }
      for (const child of item.children || []) {
        if (child.path) {
          const p = child.path.startsWith('#/') ? child.path.slice(2) : child.path;
          if (fullHash.startsWith(p) || pathname.startsWith(p)) return item.id; // parent tab ID
        }
      }
    }
  }
  return 'plan'; // fallback
}
