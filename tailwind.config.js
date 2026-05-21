// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // ── Renk Paleti ────────────────────────────────────────────────
      colors: {
        brand: {
          950: '#060d1f',
          900: '#0d1b3e',
          800: '#152a5c',
          700: '#1e3a7a',
          600: '#1d4ed8',
          500: '#3b6ef5',
          100: '#dbeafe',
          50:  '#eff6ff',
        },
        accent: {
          DEFAULT: '#f59e0b',
          600: '#d97706',
          100: '#fef3c7',
          50:  '#fffbeb',
        },
        surface: {
          DEFAULT: '#f7f8fc',  // sayfa arka planı
          card:    '#ffffff',  // kart arka planı
          subtle:  '#f1f4f9',  // ikincil yüzey
        },
        ink: {
          DEFAULT: '#0d1b3e',  // ana metin (brand-900)
          muted:   '#64748b',  // ikincil metin
          faint:   '#94a3b8',  // çok soluk metin
        },
      },

      // ── Tipografi ──────────────────────────────────────────────────
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      // ── Border Radius ──────────────────────────────────────────────
      borderRadius: {
        card:    '12px',   // kartlar, paneller, modallar
        control: '8px',    // buton, input, select, badge
        chip:    '6px',    // küçük etiketler
      },

      // ── Gölge ──────────────────────────────────────────────────────
      boxShadow: {
        card:  '0 1px 3px 0 rgba(13,27,62,0.06), 0 4px 16px -4px rgba(13,27,62,0.08)',
        panel: '0 8px 32px -8px rgba(13,27,62,0.16)',
        topbar:'0 1px 0 0 #e2e8f0',
      },

      // ── Geçiş ──────────────────────────────────────────────────────
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
};
