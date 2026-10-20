# Data model

The app keeps **rules content** (what things *are*) separate from **game state** (what is happening in one game).

## Rules content: the ruleset

Each game has one **ruleset**, a single JSON document stored in `game_rulesets.data`. Its format is defined and validated by
`src/engine/ruleset/ruleset.ts` (with `statblock.ts` and `effects.ts`). It holds:

| Part | What it is |
|---|---|
| `meta` | name, description, terminology map (rename "region" → "Province"…), theme colour, credits |
| `settings` | action slots, conditional limit, augments per unit, movement (feet → miles per day), combat (round limit, unit width by size, retreat threshold, odds runs), CR → cost table |
| `resources` | e.g. Gold, Food, Growth |
| `terrainTypes` | what terrain areas (and links) can be (Normal, Difficult, Flooded…): cost, speeds needed, colour on the map |
| `settlementTiers` | Outpost → Settlement → City → Capital |
| `buildings` | with tiers; each tier has cost, upkeep, production and effects |
| `races` | ability score bonuses and effects |
| `creatures` | units, heroes and monsters, each with a **full D&D 5e stat block** |
| `archetypes` | roles chosen when recruiting (Scout, Regiment, Defender…): tags, abilities, spells, actions |
| `spells` | spells that archetypes and items grant, with combat profiles where possible |
| `itemCategories`, `augmentSlots`, `items`, `recipes` | items and crafting |
| `actionTypes` | everything teams can order, with requirements, inputs and a handler |
| `rollTables` | dice tables with outcome bands and automatic results |
| `rulesSections` | free text for the rules reference |

Definitions refer to each other by short, readable **IDs** (`"farm"`, `"gold"`). The editor lists broken references and duplicate IDs as problems.

Why one JSON document instead of many tables? The ruleset is edited only by the DM, it's read as a whole by the rules engine, and it needs to be exported, imported and copied from presets as a unit. Validation happens in one place (`Ruleset.parse`). Each save carries a `version`, and a save based on an outdated version is refused, so two tabs can't silently overwrite each other.

### Stat blocks

A stat block stores everything printed in a D&D 5e stat block. Each action keeps its **text** (for players) and a **combat profile** (for the engine): attack, saving-throw effect, multiattack, heal, buff, spellcasting, or text only. Numbers that come from ability scores record *which* ability they use, so race, academy and augment bonuses change to-hit, damage, save DCs and HP correctly (`src/engine/ruleset/derive.ts`).

Imported SRD actions are marked `auto`, `needsReview` (a guess worth checking) or `text` (the DM handles it).

### Effects

Races, buildings, items, creatures and region features change the game through a fixed list of **effect primitives** (`src/engine/ruleset/effects.ts`): stat modifiers, advantage/disadvantage, damage reduction, vision, stealth DC, hazards, free actions, exchange rates, storage, per-round table rolls and so on. Each can require conditions (first round, allies outnumber enemies, in an owned region…). Anything else is a **text** effect that the app shows to the DM when it matters.

Building effects apply to the owning team's units in that region.

## Game state: tables

| Table | Holds |
|---|---|
| `games` | name, status, preset, current round, map image, map scale (miles across the map), map kind (old node maps are converted to regions once by `scripts/convert-maps.ts`), the public Discord webhook |
| `teams` | name, colour, emblem (an ID from `src/components/icons/emblems.ts`), join code, races, resource stockpiles, known recipes, monsters seen (for the rules reference), secret objectives, notes, Discord webhook, and when the team (any player on it) and the DM last opened their Messages conversation (`messages_read_at`, `dm_read_at`; newer messages count as unread). NPC factions are teams with `is_npc`. |
| `players` | who joined each team |
| `assets` | uploaded files (the map image), stored in the database and served only through the app |
| `regions` | shapes on the map: outline and centre (fractions of the image), code, owner, settlement tier, buildings, ruins/dungeons, deposits, features |
| `connections` | ways between regions (each pair at most once): **borders** between regions that touch (kept up to date from the shapes; can be blocked or hidden) and **links** between regions that don't (miles, terrain, hidden, blocked) |
| `terrain_areas` | difficult ground drawn over the regions: outline and terrain type |
| `units` | instances of a creature: owner (none = wild), race, archetype, academy bonus, augments, HP, region and position in it (empty = the region's centre), miles used this round, status, per-round ability uses |
| `inventory` | items per team |
| `team_region_knowledge`, `team_connection_knowledge`, `team_unit_detections`, `team_contacts` | what each team has discovered, seen, detected, and who has met whom |
| `trades` | trades between teams: what each side gives, status (proposed, accepted, declined, cancelled, executed, failed), and the result |
| `rounds` | round lifecycle (open → locked → resolving → review → published), deadline, the state when resolution started (what players see until publishing), the end-of-round results, and the published snapshot; when the deadline reminder was sent |
| `orders` | each team's ordered list for a round: position, kind (numbered / free / conditional; moves are always free), slot, the order a conditional backs up, action, inputs, notes, and during resolution its status and outcome (the app's proposal, rolls, the DM's text and adjustments) |
| `team_round_orders` | per team per round: who submitted the orders and when, and a version number so two teammates can't overwrite each other |
| `roll_log` | every roll: expression, seed, breakdown, total, table result, overrides |
| `audit_log` | every state change with before/after, for history and undo. Changes the DM makes while viewing as a team have a `dm.…` kind and the team in `team_id` (see below) |
| `messages` | the conversation between the DM and each team: who wrote it (`from_dm`, the author's name at the time), the text, and its kind (`message`, or `note` for a note sent with a DM change) |

Every table has Postgres row-level security switched on with no policies, so Supabase's public API can read nothing. The app connects from the server only. `src/db/rls.test.ts` fails if a new table forgets this.

## DM changes from "view as team"

While viewing as a team, the DM can do anything the team can, and also change its inventory and recipes. Each change is one `audit_log` row with `actor = "dm"`, the team in `team_id`, and enough `before`/`after` to undo it (`src/lib/dmEdits.ts`, with the pure parts in `src/engine/dmEdits.ts`):

| Kind | `before` / `after` hold | Undo |
|---|---|---|
| `dm.inventory` | quantities of the items that changed (0 = none) | if each item still has its `after` quantity |
| `dm.recipes` | for each recipe that changed, whether the team knew it | if the team still knows (or doesn't know) each one |
| `dm.rename` | the unit and its name | if the unit still has the new name |
| `dm.orders` | the round and order-list version; `before` also has the replaced order rows and who had submitted them | if nobody has saved the list since and the round is still open or locked |
| `dm.trade.propose` / `respond` / `cancel` | the trade's id, status and answer time (`before` is null for a new proposal) | if the trade is still in the status the DM left it; undoing a proposal deletes it |

Undo marks the row `undone` and adds an `undo` row. A change can send an optional **note** to the team (`sendDmNote` in `src/lib/messages.ts`, the tick box in `src/components/dm/TeamNoteOption.tsx`); it becomes a `messages` row with `kind = "note"`. Later DM tools can pass the same note along with their own changes.
