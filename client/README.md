# Client

React 19 + TypeScript + Vite. The user interface of the AI ERP demo (UI-001..UI-009); see the repository README for
the whole system.

```
npm install
npm run dev         # http://localhost:5173, proxies /api to the ERP API on :5001 (VITE_DEV_API)
npm test            # vitest + testing-library + msw (a mocked API: no backend needed)
npm run lint && npm run build
npm run e2e         # Playwright smoke + accessibility against the REAL stack (see e2e/README.md)
npm run screenshots # regenerates ../docs/screenshots
```

* Design tokens (colours, spacing, type, radii) are in `src/styles/tokens.css`; every page uses them.
* The session token lives in `sessionStorage` only. `src/lib/permissions.ts` mirrors the API's role matrix for what to
  show; the API enforces it.
* Production settings: `.env.example` (`VITE_API_URL`) and `vercel.json` (SPA rewrite, security headers).
