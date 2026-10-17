# Megagame

A web app for running a megagame: a long-running, many-team strategy and roleplay game.
Players submit structured orders. The app pre-rolls, pre-calculates and simulates as much as possible, and the DM reviews and publishes the results.

The app is theme-neutral. "Utterdark" will be one preset ruleset.

**First time?** Follow **[docs/SETUP.md](docs/SETUP.md)**. It walks through putting the app online with free Supabase and Vercel accounts, on Windows, step by step.

## Build status

| Phase | What | Status |
|---|---|---|
| 1 | Setup, skeleton, join-code + DM login | ✅ done |
| 2 | Data model, ruleset editor, Utterdark preset, monster CSV import | next |
| 3 | Map editor and god-mode map | |
| 4 | Player view, fog of war, order builder | |
| 5 | Resolution engine (non-combat) | |
| 6 | Combat simulation | |
| 7 | Stealth, trades, Discord, history, export | |
| 8 | Polish, guides | |

## Tech

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**, hosted on **Vercel**
- **Postgres on Supabase**, accessed only from the server through **Drizzle ORM**
- **Vitest** for tests
- **jose** for signed session cookies

## Project layout

```
src/
  engine/      Pure game-rules code (dice, seeded RNG; later economy, combat…).
               No database or web code in here, so it can be tested on its own.
  db/          Database schema (schema.ts) and connection (index.ts)
  lib/         Server helpers: sessions, join codes, health checks
  app/         Pages and server actions
    page.tsx       Landing page: join a team
    dm/            DM login and dashboard
    play/          Player area
    api/health     JSON setup check
drizzle/       SQL migrations (generated from schema.ts, applied on every deploy)
scripts/       migrate.ts
docs/          Setup guide
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run locally at http://localhost:3000 (needs `.env.local`; see `.env.example`) |
| `npm test` | Run the unit tests |
| `npm run typecheck` / `npm run lint` | Check types and code style |
| `npm run db:generate` | After editing `src/db/schema.ts`: write a new SQL migration into `drizzle/` |
| `npm run db:migrate` | Apply migrations to the database in `DATABASE_URL` (Vercel does this on each production deploy) |

## Security model

- The browser never talks to the database. There is no public Supabase key in the app. Every read and write goes through server code that checks the session first.
- Row-level security is switched on for every table with no policies, so Supabase's auto-generated public API can't read anything even if someone finds the project URL. A test (`src/db/rls.test.ts`) fails if a new table forgets this.
- Players join by exchanging a team join code for a signed, httpOnly session cookie. Each request re-checks the session against the database, so regenerating a team's code signs that team out immediately.
- The DM logs in with the `DM_PASSWORD` environment variable.
- From Phase 4 on, all player data will come from server endpoints that compute **that team's** fog-of-war view.
