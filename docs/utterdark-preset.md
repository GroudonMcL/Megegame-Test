# The Utterdark preset

Built from `reference/utterdark-rules.md` in `src/presets/utterdark.ts`. Create a game with **Start from: Descent into the Utterdark** to get a copy you can edit freely.

## Units are SRD 5.2 creatures

Player units use official SRD 5.2 stat blocks. Recruit cost and upkeep come from the **CR cost table** (Game settings), and each unit can override it.

| Utterdark unit | SRD 5.2 stat block | CR |
|---|---|---|
| Guard | Guard | 1/8 |
| Healer | Priest Acolyte | 1/4 |
| Miner | Tough | 1/2 |
| Scout | Scout | 1/2 |
| Regiment | Warrior Veteran | 3 |
| Mage | Mage | 6 |
| War Priest (hero) | Priest | 2 |
| Beastmaster (hero) | Druid (no SRD beastmaster exists) | 2 |
| Champion (hero) | Gladiator | 5 |
| Necromancer (hero) | Mage (no SRD necromancer exists) | 6 |
| Assassin (hero) | Assassin | 8 |
| Archmage (hero) | Archmage | 12 |

The old Utterdark *combat* abilities (Martial Advantage, Sneak Attack, Spellcasting I/IV, Grim Harvest…) are replaced by the SRD stat blocks' own abilities. Abilities that matter outside combat are kept as tags and effects:

- Guard: **Defender** tag (double fortification), advantage on Search.
- Miner: unlocks Excavate and Extract Deposit.
- Scout and Assassin: Stealthy (Stealth move and Spy), and see adjacent regions.
- Regiment: needed to Annex.
- Healer: free full heal with Heal Unit.
- Archmage: Teleport.
- Beastmaster: tame and store beasts, with advantage on taming and capturing.
- Necromancer: Reanimate, and raises a slain humanoid as a Zombie once per combat.
- War Priest: advantage on Divine Intervention.

**Movement:** every SRD humanoid walks 30 ft, which is 2 regions per round with the default settings. The old Scout had 4 regions; to keep that, give the Scout a 60 ft walking speed.

## Placeholders (waiting for the DM sheet)

Marked **PLACEHOLDER** in the app:

- Growth produced by each settlement tier (Outpost 2, Settlement 4, City 6, Capital 8).
- Starting resources (10 Gold, 5 Food, 10 Growth).
- Races and their bonuses.
- Example items, augments and recipes (Pickaxes, Chain Shirt, Tower Shield, Silk Cloak, Healing Draught).
- Every roll table's bands and results: Excavate, Extract, New Region, Hunter's Post, Divine Intervention (d100), Race, Loot, Encounter, Dungeon, Search, Spy, Tavern, Turn Event, Economy Deficit.
- The CR cost table, calibrated so the old prices roughly carry over.

## Where the rules disagreed

| Topic | Versions | Used |
|---|---|---|
| Teleport | 80/15/5 (Actions list) vs 50/25/15/10 (Archmage) | **50/25/15/10**, the later and more detailed one |
| Heal Unit cost | Gold only (Healer) vs Gold *or* Food, mix and match (Actions list) | **1 Gold per 5 HP or 1 Food per 10 HP, mixed**, minimum 1 |
| Hunter Post tiers 2–3, Smithy, Watchtower tiers | Every tier costs the same | Kept exactly as written; edit if they were typos |

## Rules the app can only show as text (the DM handles them)

- Guard **Vigilant**: negates extra damage from hidden units.
- **Breeding Pits**: a new tamed monster after a number of rounds based on CR.
- **Menagerie**: beasts are released and attack when the region is raided or attacked.
- Monster upkeep of "Food equal to half its CR" is approximated by the CR cost table.
- **Divine Intervention** outcomes, **Improvise**, and the consequences of an economy deficit beyond the table roll.
- The **Market** requirement ("you own a Market") is checked by the DM until Phase 5 adds the handler check.

Deposits can carry their own per-round production for "raw resources claimed through mining produce 2 income".
