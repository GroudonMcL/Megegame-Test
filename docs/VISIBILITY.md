# Fog of war

What each team can see is worked out on the server every time a player opens a page (`src/engine/world/visibility.ts`). Only the result is sent to their browser.

## Regions

A team **sees** a region (its details, buildings and units) if:

1. it owns the region;
2. it has a unit there (active or stealthed);
3. the DM has given it permanent vision of the region; or
4. the region is within vision range of one of its units or buildings. A Scout or Assassin archetype sees 1 region away, and so does a Watchtower (tier 2+). Range goes along borders and links the team knows about.

Regions are shapes on the map; regions that touch (along an edge or at a corner) are neighbours, joined by a **border**. A **blocked** border (a wall, a cliff) counts as no border at all, for seeing as well as for moving. Regions that don't touch can be joined by a **link** (a tunnel, a sea lane).

Hidden regions and hidden connections stay invisible until the team has discovered them (the DM marks this; Phase 5 does it from Excavate and Explore results).

Other regions a team may get:

- **Seen before**: shown dimmed, with what the team last saw (owner, settlement, buildings, ruins, deposits) and the round it saw it. Units are never remembered. The DM can switch this off in **Ruleset → Game settings → Fog of war**.
- **Unexplored**: a region next to one the team sees, shown as "?" with its outline but no name or details, so players can plan moves into it.

Anything else is not sent at all.

## Units

- The team's own units: everything.
- Other teams' units and wild monsters in a region the team sees: **only the type and the owner** (e.g. "Knight · Iron Clan"). No names, HP, augments or stats.
- Stealthed units of other teams stay invisible until this team has detected them.
- The first time a team sees a monster type, its stat block appears in the team's rules reference.

## The map image

The server paints fog onto the map image before sending it: solid fog everywhere except the regions the team sees (cleared to their outline) and the regions it has seen before (dimmed). A region without a shape yet gets a circle instead; its size, and an option to turn image fogging off, are in **Game settings → Fog of war**.

## Terrain

Terrain areas (forest, swamp, water…) are cut down on the server to the parts inside regions the team sees or remembers, so nothing about unseen ground is sent.

## Moves into the unknown

A route may go into ground the team can't see. While players write orders, the app can only check the part it knows (and estimates the rest at normal cost); when the DM resolves the round, the whole route is traced on the real map, including hidden borders the team hasn't discovered (shut to it) and open ground outside every region (impassable).

## Rules

Players get the ruleset without the monster library (except monsters they've met), without roll-table outcomes, and without recipes they haven't learned.

## The DM

The DM sees everything on the World map. **View as team** (on the game's Teams page) shows the player screens exactly as that team sees them, and lets the DM act for the team (orders, unit names, trades) and change its inventory and recipes. Viewing as a team never changes what the team remembers: every page loads the team's view without recording it, and the DM's own controls (the item and recipe editors, the DM log) are only sent when the DM is viewing. Opening the team's Messages there doesn't mark them read for the team.

## Messages

Each team's conversation with the DM is sent only to that team's players and to the DM.

## Checking orders

Orders are checked against the team's own view, in the browser as they build them and again on the server when they save. A check can only say things the team could know: for example, "hostile units in the region" only counts units the team can see. The real game state is checked again when the DM resolves the round (Phase 5).
