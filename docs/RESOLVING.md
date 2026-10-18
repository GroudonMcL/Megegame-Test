# Resolving a round (DM guide)

Everything happens on the game's **Resolve round** tab.

1. **Start resolving.** This locks orders (if you haven't already) and freezes what players see: until you publish, their screens show the world as it was at this moment.
2. **Work through the queue.** It's every team's action 1, then every team's action 2, and so on. Free actions sit with the numbered action before them, and backup (conditional) orders sit with the order they back up.
   - Click **Prepare action N**. The app re-checks each order against the real game state (including things the team couldn't see), rolls any dice, and drafts the outcome. Moves within one action are treated as happening at the same time.
   - Each order is marked **Ready**, **Needs review** (it has a roll or something to check by hand), **Needs DM** (Improvise and other hand-resolved actions), or **Can't happen** (with the reason).
   - **⚑ Flags** above the list show teams acting in the same region, orders aimed at another team, and different sides ending up in the same region (a likely fight). Linked orders share a **scene** number so you can resolve them together.
   - For each order you can edit the outcome text, add or take away resources, hide the rolls from the team, then **Accept**. You can also **Re-roll** it, **Mark failed** (any backup order after it becomes active), or **Skip** it.
   - **Accept all ready** accepts every Ready order in that action.
   - When you accept, the app re-runs the order with the same dice against the current state, so earlier decisions are taken into account. If it can no longer happen, you're told why.
   - **Fights** caused by an order (a move into monsters, an Attack or a Capture Monster) are simulated and shown on the order with their log. See **[COMBAT.md](COMBAT.md)** for the rules and your controls.
3. **Undo last** reverses the most recent accept, fail, skip or end of round, one step at a time.
4. **Go to end of round.** The app works out each team's production and upkeep, per-round building rolls, region hazards, and an economy-deficit roll for anyone who goes negative. Adjust any team's resources, or **Recalculate and re-roll**, then **Apply end of round**. This also resets every unit's movement.
5. **Publish.** Teams see their results (each order's outcome, rolls you didn't hide, resource changes, and the end-of-round summary) on their **Results** page and dashboard. A snapshot of the game is kept for history. Then open the next round on the Teams page.

## Things you still do by hand (for now)

- **Stealth checks** on stealthy moves (Phase 7).
- **Discoveries**: revealing a passage or region, adding a deposit or ruin. The order tells you what the table rolled; make the change in the Map editor.
- **Trades, portals, taming, spells and Improvise**: these are marked **Needs DM**. Write the outcome and add resources, or make the changes on the World map.
- Changes you make on the World map or Map editor take effect at once and aren't part of **Undo last**.

## Decisions built in

- **Unsubmitted drafts.** Orders a team saved but never submitted still appear in the queue, marked **draft**. Skip them if you only want submitted orders.
- **New units.** A unit recruited this round appears at full HP but can't move until next round.
- **End-of-round timing.** Buildings, settlements and units added this round count in this round's end-of-round income and upkeep.
