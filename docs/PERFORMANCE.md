# Performance at full size

The app is meant to handle a big megagame: **15 teams and 150+ regions**. This page records how that was checked and what to expect.

## The load-test game

`npm run seed:load-test` adds a game called "Load test (15 teams) …" with:

- 15 teams (each with a home settlement), 159 regions in a grid, 276 connections;
- 310 units (18 per team plus 40 wild monsters);
- round 1 open, with six submitted move orders per team (90 orders).

It prints the join codes and the game's DM address. **It writes to whatever database `DATABASE_URL` points at.** If your PC copy uses the live database (see SETUP.md), the game will appear on your DM dashboard. You don't need to run it to play.

## Results (October 2026, local database)

Page loads, with the server already warm:

| Page | Time | Download (compressed) |
|---|---|---|
| DM: Teams / Resolve / Diplomacy / History | 0.1–0.3 s | 3–27 KB |
| DM: World map / Map editor | 0.2–0.4 s | about 100–115 KB |
| Player: dashboard, units, regions, results, trades | 0.1–0.2 s | 3–11 KB |
| Player: map, orders | 0.2–0.3 s | about 53 KB |
| Player: rules reference | 0.3–0.7 s | about 100 KB |

Resolving a full round of 90 orders: about 0.25 s to prepare each action, 0.35 s to accept all of an action's ready orders, 0.3 s for the end of round and 0.2 s to publish.

The number of database queries per page stays the same whatever the number of teams (between 3 and 22), so the live site (Vercel + Supabase) adds a roughly fixed delay per page rather than one that grows with the game.

## What was changed for speed

- **Rules are cached.** A full ruleset (Utterdark's is about 400 KB) used to be read from the database and checked on every page. Now each server keeps the checked copy and only asks the database for its version number, re-reading it after the DM saves a change.
- **The player map opens on the team's own regions**, rather than the whole map, so a big map is readable on a phone straight away. **Whole map** zooms out.
