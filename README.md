# Capstone Admin Dashboard

Admin web application for managing riders, parcels, violations, analytics, and report generation.

## Stack

- React + Vite
- Supabase (`@supabase/supabase-js`)
- Chart.js, Leaflet
- Vercel deployment + Vercel Analytics

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm 9+
- Supabase project with required tables

## Environment Variables

Create a `.env` file in the project root:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

For Vercel, add the same variables in Project Settings -> Environment Variables.

## Local Setup

```bash
npm install
npm run dev
```

Default dev URL: `http://localhost:5173`

## Commands

```bash
npm run dev        # local development
npm run lint       # eslint checks
npm run test       # watch mode tests (vitest)
npm run test:run   # single run tests
npm run build      # production build
npm run preview    # preview production build
```

## Automated Tests

Current automated tests include:

- `src/components/PageSpinner.test.jsx`
- `src/hooks/useDarkMode.test.jsx`

Run all tests:

```bash
npm run test:run
```

## Deployment (Vercel)

1. Push to GitHub.
2. Connect the repository to Vercel.
3. Set environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

Routing is configured for SPA refresh support in `vercel.json` via rewrite to `index.html`.

## Demo Fallback Plan

If live internet is unstable:

1. Run local app: `npm run dev`
2. Use prepared demo accounts and preloaded data
3. Keep screenshots / exported reports ready for backup evidence

## Notes

- Vercel Hobby has deployment limits per day. Avoid unnecessary pushes during defense day.
- Vercel Analytics is integrated through `@vercel/analytics`.
