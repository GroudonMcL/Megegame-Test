# The Utterdark preset

Built in `src/presets/utterdark.ts` from `reference/utterdark-rules.md`, the DM sheet's "Player Reference" tab (`reference/utterdark-dm-sheet.csv`), and the DM's Master Tracker and DM Sheet spreadsheets (see "From the spreadsheets" below). Create a game with **Start from: Descent into the Utterdark** to get a copy you can edit freely.

## Units, archetypes and spells

**Units are plain SRD 5.2 stat blocks under their own names**: 11 standard units (Guard, Warrior Infantry, Priest Acolyte, Scout, Tough, Spy, Druid, Priest, Berserker, Warrior Veteran, Knight) and 5 heroes (Guard Captain, Gladiator, Mage, Assassin, Archmage). Add more from **Units & monsters → + From SRD…**. Recruit cost and upkeep come from the **CR cost table** (Game settings) unless a unit overrides them.

**Archetypes** give a unit its role. The player picks one when recruiting. Archetypes add tags, abilities, spells and actions on top of the stat block:

| Standard | Heroes |
|---|---|
| Defender, Druid (needs a Farm), Healer, Mage, Miner (needs a Mine), Monk, Regiment, Scout | Archdruid, Archmage, Artificer, Assassin, Bard, Beastmaster, Champion, Necromancer, War Priest |

Their abilities come from the DM sheet. Where the effects system can express an ability, the app automates it: for example Martial Advantage, Sneak Attack, Survivalist (no Food upkeep), Magic Resistance, Indomitable, Uncanny Dodge, Raise Dead, the Artificer's 4-item limit, and the spell lists. The rest are "text only" (see below).

The **spell list** has all 29 spells from the sheet. Combat spells that can be automated have combat profiles: Blast, Greater Blast, Smite, Harm, Shatter, Ray of Sickness, Charm, Sleep, Faerie Fire, Ray of Enfeeblement, Bless, Haste, Heal, Greater Heal and Revivify. The combat simulation uses them; the ones marked "check" are worth a look in the ruleset editor. "Con/Dex save" means the target uses its better save. Spell DCs use the caster's Intelligence (Arcane) or Wisdom (Divine and Primal).

## From the DM sheet

- **Settlements:** Gold and Growth costs, Food upkeep, Gold and Growth production, building slots, and the "for every settlement you need N outposts" requirements. Only one Capital is allowed.
- **Buildings:** every cost, upkeep and production figure. Hunter's Post, Tavern, Temple (Respite, Divine Intervention), Smithy (Craft) and Portal grant their free actions.
- **Actions:** the full list from the sheet, including Cast Spell, Claim (replaces Annex), Explore (replaces Search), Extract (deposit with STR/CON or corpse with INT/WIS), Train in Academy and Train Population.
- **Free actions:** the full list from the sheet, except Apply Augment. A setting allows one free action per unit per turn, not counting moves.
- **Augments** are equippable items (the Augment category, with the sheet's slots: Armour, Consumable ×3, Equipment ×2, Shield, Weapon or Tool; 3 per unit, 4 for an Artificer). Teams equip them from the unit's **Edit** window instead of with Apply Augment, straight away, while the round is open and the unit is in a region they own. The sheet's "you can't unequip an item and equip it on another unit in the same turn" is the **swap lock** setting, which is on.
- **Moves:** Move Units, Move Units – Stealth (half the miles) and Move Units – Force March (double the miles, disadvantage in fights) are free actions, unlike the sheet: a unit can move as often as its movement for the round allows. This stops one numbered Move from carrying a whole stack while spreading out costs extra actions.
- **Population** is a new resource. Train Population turns 100 Growth into +1 Population, and disbanding a healthy unit refunds 1.
- **Diplomatic agreements** are in the rules text.

## From the spreadsheets

`scripts/import-utterdark-sheets.py` reads the Master Tracker and DM Sheet and writes `src/presets/utterdark-data.json`. The spreadsheets themselves aren't in the repository, because they hold players' names and secrets. Run the script again whenever they change:

```
python3 -I scripts/import-utterdark-sheets.py "Master Tracker.xlsx" "DM SHEET.xlsx"
```

The old unit stat blocks, abilities and units in the sheets are ignored on purpose: units use full SRD 5.2 stat blocks.

- **Items and augments** (352, Master Tracker AUG tab): rarity, type, requirements (Martial, Spellcaster, Hero, Miner, race), the AC, to-hit, damage, attacks, save DC, movement and ability-score columns, and descriptions. Where the ability text is simple the app automates it: shields' damage reduction, bombs and flasks ("save or take N damage"), advantage or disadvantage on Stealth and Initiative, pickaxe bonuses, and scrolls (which cast their spell once). Anything else stays as text for the DM. Movement is converted at 1 region = 15 ft of speed.
- **Recipes** (156, DM Sheet AUGMENTS "Crafted From"): "2x" quantities are kept. "A/B/C" means any one of them, so it becomes one recipe per choice.
- **Races** (21, DM Sheet VALIDATION tab): Bugbear, Derro, Drow, Duergar, Dwarf, Fire Giant, Githyanki, Goblin, Hobgoblin, Human, Illithid, Kobold, Kuo-Toa, Lizardfolk, Minotaur, Myconid, Neogi, Orc, Stone Giant, Svirfneblin and Troglodyte, with their ability bonuses.
- **Roll tables** (Master Tracker DM REFERENCE tab): Divine Intervention, Excavate, New Region, Extract, Hunter's Post, Race, Search Region, Search Ruin, Spy, Tavern, both Teleport tables, Turn Event, the Gold and Food deficit tables, the five Treasure tables and the four Material tables. Results the app can apply are applied: gold and food, items, rolling on other tables (including "re-roll, ignoring…" and bonus items), deposits, ruins, cave-in damage, and survivors joining as a new race.
- **Encounter tables** (DM Sheet TABLES): the encounter table and the Inconvenience, Low, Medium and High CR, Demon and Cultist tables. Monsters that are in the SRD appear on their own; the rest (Drow, Duergar, Kuo-Toa and other non-SRD creatures) and "A or B" choices are left to the DM.
- **Monster materials:** each monster's harvestable materials come from the AUGMENTS "Source" column.
- **Starting resources:** 30 Gold, 10 Food, 25 Growth (Master Tracker ECO tab).

## Still placeholders

- The **Dungeon** table (not in either sheet).
- The **CR cost table** for recruiting units.
- Spelling slips in the sheets are matched automatically (e.g. "Aether Whisp", "Pickaces"). One recipe input, "Monster Drop", couldn't be matched and was left out.

## Choices made

| Topic | Choice |
|---|---|
| Upgrade Settlement | Not on the sheet's action list, but kept, because settlements need a way to grow past Outpost |
| Teleport | The two tables from the DM REFERENCE tab (familiar and not familiar) |
| Explore | Became **Search**: Region, Ruin, Dungeon or Hidden units, each with its own table and abilities (INT or WIS) |
| Extract from a corpse | DEX or WIS, as on the DM REFERENCE tab |
| Trade action | Removed: trades use the Trades page instead |
| Turn events | Rolled for every team at the end of each round ("each faction can have 1 event per turn"), +1 per 6 regions. The DM can untick teams. The −1 per improvise/temple/tavern is shown as a note. |
| Gold and Food deficits | Their own tables: +1 per Gold short, +2 per Food short. "Turns in debt" isn't tracked; add it by hand. |
| Heal Unit | 5 HP per Gold or 10 HP per Food |
| Population per race | The sheet says Train Population gives "+1 population of base race". For now Population is one shared resource; per-race tracking can come with the recruit rules in Phase 5. |

## Rules the app shows as text (the DM handles them)

Defender's movement restriction, Vigilant, Tend Nature, Healer/Lifebringer free heals, Survivalist's Hunter's Post assist, Assassinate, Inspiration, Improviser, Song of Rest, Beast Bond damage redirection, Hunter's Mark, Tracker, Second Wind, Inspiring Leader, Grim Harvest, Profane Ritual, Tinker, Wildshape, Bound, Undead/Construct healing costs, Breeding Pits, the Menagerie release, and the out-of-combat spells (Plant Growth, Scry, Teleport, Reincarnate, Resurrection, True Resurrection, Wish). Fights list the combat-only ones under "Not automated" so the DM can account for them.
