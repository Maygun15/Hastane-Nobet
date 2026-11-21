import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// Taban çizgi (G, 22 Kas 2026): hata = gerçek hata riski (koşullu kanca, tanımsız değişken,
// sözdizimi). Biçim/temizlik bulguları uyarı olarak izlenir, sayıları COMMERCIAL_READINESS.md'de.
export default defineConfig([
  globalIgnores(['dist', 'my-backend-project', 'coverage', 'node_modules', 'ai-vscode', 'docs']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'react-refresh/only-export-components': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['test/**', 'scripts/**', '**/*.test.{js,jsx}', 'src/test/**', 'vite.config.js', 'vitest.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.vitest } },
  },
])
