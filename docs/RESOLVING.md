# Resolving a round (DM guide)

Everything happens on the game's **Resolve round** tab.

1. **Start resolving.** This locks orders (if you haven't already) and freezes what players see: until you publish, their screens show the world as it was at this moment.
2. **Work through the queue.** It goes in steps: **moves, action 1, moves, action 2, moves, action 3**, and so on, ending with a last move step.
   - **Moves are free actions.** Move, Stealth Move and Force March never use a numbered slot; each unit is limited only by its own movement for the round (its miles used, shown in the team's **Movement left** table). A unit can be given several moves in a round, and each one uses miles from every unit in it. Repositioning units inside a region is a move too. There is no limit on units per region.
   - A team's moves listed before its action 1 resolve in the first move step (**Moves before action 1**), moves listed between action 1 and action 2 in the second (**Moves before action 2**), and so on; moves listed after the team's last action resolve in the last move step (**Moves after action N**). So "move, then attack" works.
   - Other free actions sit with the numbered action before them (or action 1), and backup (conditional) orders sit with the order they back up.
   - Click **Prepare moves** or **Prepare action N**. The app re-checks each order against the real game state (including things the team couldn't see), rolls any dice, and drafts the outcome. Moves within one move step are treated as happening at the same time for all teams.
   - Each order is marked **Ready**, **Needs review** (it has a roll or something to check by hand), **Needs DM** (Improvise and other hand-resolved actions), or **Can't happen** (with the reason).
   - **⚑ Flags** above the list show teams acting in the same region, orders aimed at another team, and different sides ending up in the same region (a likely fight). Linked orders share a **scene** number so you can resolve them together.
   - For each order you can edit the outcome text, add or take away resources, hide the rolls from the team, then **Accept**. You can also **Re-roll** it, **Mark failed** (any backup order after it becomes active), or **Skip** it.
   - **Accept all ready** accepts every Ready order in that step.
   - **Filters**: show one **Team**, one **Step** (a move step or an action), or **Only flagged** orders (those in a scene).
   - **Keyboard shortcuts** (press **?** on the page for the list): **j**/**k** next/previous order, **a** accept and move on, **f** mark failed, **s** skip, **r** re-roll, **e** edit the outcome text (**Esc** to leave it), **Shift+A** accept all ready in this step, **p** prepare the next step. They're ignored while you're typing in a box.
   - When you accept, the app re-runs the order with the same dice against the current state, so earlier decisions are taken into account. If it can no longer happen, you're told why.
   - **Fights** caused by an order (a move into monsters, an Attack or a Capture Monster) are simulated and shown on the order with their log. See **[COMBAT.md](COMBAT.md)** for the rules and your controls.
3. **Undo last** reverses the most recent accept, fail, skip or end of round, one step at a time.
4. **Go to end of round.** The app works out each team's production and upkeep, per-round building rolls, random events (pick the teams in **Random events**), region hazards, a deficit roll for each resource a team runs short of, and finally any **accepted trades** (each one goes through only if both sides still have what they offered). Adjust any team's resources, or **Recalculate and re-roll**, then **Apply end of round**. This also resets every unit's movement.
5. **Publish.** Teams whose units saw each other this round are marked as having met (so they can trade), the game's Discord channel hears that the round is done, and each team's channel gets "your results are ready". Teams see their results (each order's outcome, rolls you didn't hide, resource changes, and the end-of-round summary) on their **Results** page and dashboard. A snapshot of the game is kept for history. Then open the next round on the Teams page.

## Things you still do by hand (for now)

- **Discoveries**: revealing a passage or region, adding a deposit or ruin. The order tells you what the table rolled; make the change in the Map editor.
- **Trades, portals, taming, spells and Improvise**: these are marked **Needs DM**. Write the outcome and add resources, or make the changes on the World map.
- Changes you make on the World map or Map editor take effect at once and aren't part of **Undo last**.

## Decisions built in

- **Unsubmitted drafts.** Orders a team saved but never submitted still appear in the queue, marked **draft**. Skip them if you only want submitted orders.
- **New units.** A unit recruited this round appears at full HP but can't move until next round.
- **Old move orders.** Games started before moves became free have Move saved as a numbered action, in the ruleset and in orders. Both load as free moves: the ruleset's move actions turn free when it loads, and a move order saved as numbered takes its move step from where it sits in the list.
- **End-of-round timing.** Buildings, settlements and units added this round count in this round's end-of-round income and upkeep.
