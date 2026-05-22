/**
 * src/styles/theme.js
 *
 * Modül bazlı tema tanımları. Her modül kendi renk, ikon ve buton
 * stillerini taşır. ThemeProvider bu nesneyi Context'e enjekte eder;
 * bileşenler useModuleTheme() hook'u ile okur.
 *
 * KURAL: Tailwind sınıf adları tam literal string olmalıdır (PurgeCSS).
 *        Asla 'bg-${color}-600' gibi dinamik string kullanma.
 */

// ── Yardımcı tip: ModuleTheme ─────────────────────────────────────────────────
/**
 * @typedef {Object} ModuleTheme
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {{ hex: string, light: string }} colors
 * @property {{ primary: string, secondary: string, danger: string, reset: string }} button
 * @property {{ color: string, bg: string }} icon
 * @property {string} heading
 * @property {string} border
 * @property {string} badge
 * @property {string} indicator      — aktif/seçili çizgi rengi
 * @property {string} ring           — focus ring rengi
 * @property {string} linkHover      — sidebar link hover bg
 * @property {string} linkActive     — sidebar aktif item bg + text
 */

// ── Modül tanımları ───────────────────────────────────────────────────────────

/** @type {Record<string, ModuleTheme>} */
export const MODULE_THEMES = {

  // ──────────────────────────────────────────────────────────────────
  // HASTANE — Soft Blue
  // Var olan uygulamanın temel modülü.
  // ──────────────────────────────────────────────────────────────────
  hastane: {
    id:          'hastane',
    label:       'Hastane',
    description: 'Nöbet çizelgesi ve personel yönetimi',
    colors: {
      hex:   '#2563eb',   // blue-600
      light: '#eff6ff',   // blue-50
    },
    button: {
      primary:   'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm',
      secondary: 'bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 border border-blue-200',
      danger:    'bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200',
      reset:     'bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 border border-slate-200',
    },
    icon:        { color: 'text-blue-600',  bg: 'bg-blue-50'   },
    heading:     'text-blue-900',
    border:      'border-blue-200',
    badge:       'bg-blue-100 text-blue-700',
    indicator:   'bg-blue-600',
    ring:        'focus:ring-blue-300',
    linkHover:   'hover:bg-blue-50 hover:text-blue-700',
    linkActive:  'bg-blue-50 text-blue-700 font-medium',
  },

  // ──────────────────────────────────────────────────────────────────
  // ŞEHİR — Teal / Smart City
  // ──────────────────────────────────────────────────────────────────
  sehir: {
    id:          'sehir',
    label:       'Akıllı Şehir',
    description: 'Şehir yönetimi ve altyapı takibi',
    colors: {
      hex:   '#0d9488',   // teal-600
      light: '#f0fdfa',   // teal-50
    },
    button: {
      primary:   'bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white shadow-sm',
      secondary: 'bg-teal-50 hover:bg-teal-100 active:bg-teal-200 text-teal-700 border border-teal-200',
      danger:    'bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-700 border border-amber-200',
      reset:     'bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 border border-slate-200',
    },
    icon:        { color: 'text-teal-600',  bg: 'bg-teal-50'   },
    heading:     'text-teal-900',
    border:      'border-teal-200',
    badge:       'bg-teal-100 text-teal-700',
    indicator:   'bg-teal-600',
    ring:        'focus:ring-teal-300',
    linkHover:   'hover:bg-teal-50 hover:text-teal-700',
    linkActive:  'bg-teal-50 text-teal-700 font-medium',
  },

  // ──────────────────────────────────────────────────────────────────
  // PROJE — Violet / Project Management
  // ──────────────────────────────────────────────────────────────────
  proje: {
    id:          'proje',
    label:       'Proje Yönetimi',
    description: 'Görev takibi ve ekip koordinasyonu',
    colors: {
      hex:   '#7c3aed',   // violet-600
      light: '#f5f3ff',   // violet-50
    },
    button: {
      primary:   'bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white shadow-sm',
      secondary: 'bg-violet-50 hover:bg-violet-100 active:bg-violet-200 text-violet-700 border border-violet-200',
      danger:    'bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200',
      reset:     'bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 border border-slate-200',
    },
    icon:        { color: 'text-violet-600', bg: 'bg-violet-50'  },
    heading:     'text-violet-900',
    border:      'border-violet-200',
    badge:       'bg-violet-100 text-violet-700',
    indicator:   'bg-violet-600',
    ring:        'focus:ring-violet-300',
    linkHover:   'hover:bg-violet-50 hover:text-violet-700',
    linkActive:  'bg-violet-50 text-violet-700 font-medium',
  },

  // ──────────────────────────────────────────────────────────────────
  // FİNANS — Emerald + Amber/Gold
  // 'Sıfırla' ve tehlikeli butonlar amber tonda — kırmızı değil.
  // ──────────────────────────────────────────────────────────────────
  finans: {
    id:          'finans',
    label:       'Finans',
    description: 'Bütçe takibi ve mali raporlama',
    colors: {
      hex:   '#059669',   // emerald-600
      light: '#ecfdf5',   // emerald-50
    },
    button: {
      primary:   'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm',
      secondary: 'bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 border border-emerald-200',
      danger:    'bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-700 border border-amber-200',
      reset:     'bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-600 border border-amber-200',
    },
    icon:        { color: 'text-emerald-600', bg: 'bg-emerald-50' },
    heading:     'text-emerald-900',
    border:      'border-emerald-200',
    badge:       'bg-emerald-100 text-emerald-700',
    indicator:   'bg-emerald-600',
    ring:        'focus:ring-emerald-300',
    linkHover:   'hover:bg-emerald-50 hover:text-emerald-700',
    linkActive:  'bg-emerald-50 text-emerald-700 font-medium',
  },

  // ──────────────────────────────────────────────────────────────────
  // E-TİCARET — Orange
  // ──────────────────────────────────────────────────────────────────
  eticaret: {
    id:          'eticaret',
    label:       'E-Ticaret',
    description: 'Sipariş ve stok yönetimi',
    colors: {
      hex:   '#ea580c',   // orange-600
      light: '#fff7ed',   // orange-50
    },
    button: {
      primary:   'bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white shadow-sm',
      secondary: 'bg-orange-50 hover:bg-orange-100 active:bg-orange-200 text-orange-700 border border-orange-200',
      danger:    'bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 border border-red-200',
      reset:     'bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-600 border border-slate-200',
    },
    icon:        { color: 'text-orange-600', bg: 'bg-orange-50'  },
    heading:     'text-orange-900',
    border:      'border-orange-200',
    badge:       'bg-orange-100 text-orange-700',
    indicator:   'bg-orange-600',
    ring:        'focus:ring-orange-300',
    linkHover:   'hover:bg-orange-50 hover:text-orange-700',
    linkActive:  'bg-orange-50 text-orange-700 font-medium',
  },
};

export const DEFAULT_THEME = MODULE_THEMES.hastane;

/** Modül ID'sinden tema al; bilinmiyorsa hastane döner. */
export function getModuleTheme(moduleId) {
  return MODULE_THEMES[moduleId] ?? DEFAULT_THEME;
}
