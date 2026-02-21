## Quick orientation for code-writing agents

This repo is a small React + Vite frontend (SPA) paired with an Express + Mongo backend under `my-backend-project/`.
Give actionable, code-localized suggestions — reference files and examples below.

High level
- Frontend: `src/` — React 18, Vite. Entry: `src/main.jsx` → `src/App.jsx` → `src/app/HospitalRosterApp.jsx`.
- Backend: `my-backend-project/index.js` — Express routes live in `my-backend-project/routes/` and models in `my-backend-project/models/`.

Auth & API patterns
- Frontend stores JWT in localStorage under key `authToken`. Helpers: `src/lib/api.js` and `src/api/apiAdapter.js` (adapter used to map external APIs).
- Backend uses JWT (`JWT_SECRET`) and exposes `/api/auth/login`, `/api/auth/me`. Dev login is enabled by `ALLOW_DEV_ENDPOINTS`.
- Typical data endpoints: `/api/schedules/monthly` (GET/PUT) implemented in `my-backend-project/routes/schedules.routes.js` and monthly schedule model `my-backend-project/models/MonthlySchedule.js`.

Project conventions and pitfalls
- API base: frontend reads VITE_API_BASE or falls back to window.__API_BASE__ or localhost heuristics (see `src/api/apiAdapter.js` and `src/lib/api.js`). Prefer editing these files when changing endpoints.
- Token lifecycle: `src/lib/api.js` clears `authToken` on 401 and emits logout via window event (AuthContext listens). Use `getToken()` / `setToken()` helpers.
- Date/month state: there is a legacy/localStorage compatibility layer. `src/hooks/useActiveYM.js` writes multiple keys (`activeYM.year`, `activeYM.month`, `plannerMonth`, `plannerMonth1`) and dispatches `activeYM:changed` and `storage` events — touch these when changing month/year behavior.
- Local state backup: many UI lists persist to a simple `LS` wrapper (`src/utils/storage.js`). Prefer using that helper instead of direct localStorage access.

RBAC and data-shape notes
- Roles: normalized to `user|staff|admin` in `my-backend-project/models/User.js`. Frontend uses `utils/acl.js` and `PERMISSIONS` constants in `constants/roles.js` to gate UI.
- User identification: backend `findByIdentifier` accepts email/phone/tc (TCKN). When adding user-facing forms honor same identifier conventions.

Dev / run instructions (what humans use)
- Frontend dev: `npm run dev` (root package.json) — Vite default port configured in `vite.config.js` (5174).
- Frontend build: `npm run build` and preview with `npm run preview`.
- Backend dev: run `node my-backend-project/index.js` (set env vars: `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_ORIGIN`, `ALLOW_DEV_ENDPOINTS=true` for dev login). The backend defaults to port 3000.

Where to make common changes
- Change API endpoints / behaviour: `src/lib/api.js` (frontend HTTP wrapper) and `src/api/apiAdapter.js` (app-level adapters/mappers).
- Auth UX/flow: `src/auth/AuthContext.jsx` and `src/lib/api.js` (token helpers and `/me` handling).
- YM/month handling: `src/hooks/useActiveYM.js`, `src/utils/activeYM.js`, and `src/state/bootAppStoreFromLegacy.js`.
- Schedule persistence: backend model `my-backend-project/models/MonthlySchedule.js` and routes `my-backend-project/routes/schedules.routes.js`.

Quick examples to cite in edits
- To call monthly schedule: frontend uses `fetch('/api/schedules/monthly?sectionId=...&year=2025&month=9')` (see `src/api/apiAdapter.js` and `src/lib/api.js`).
- To persist auth token from backend login response set: `setToken(data.token)` (pattern used in `src/lib/api.js`).

Testing & safety
- Many backend routes assume `requireAuth`/`sameServiceOrAdmin` middleware. When adding endpoints, reuse these from `my-backend-project/middleware/authz.js`.
- Be conservative when changing storage keys — multiple components listen to storage events and legacy keys.

If unsure
- Point to the smallest files mentioned above in PR descriptions and include a short manual test (steps to reproduce: endpoints to call or UI flows to exercise). Ask for environment vars when requiring DB or dev-login toggles.

If you want me to rewrite or extend any section, say which area to expand (auth, API, YM handling, RBAC, dev setup).
