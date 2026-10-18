# The Utterdark preset

Built in `src/presets/utterdark.ts` from `reference/utterdark-rules.md` and the DM sheet (`reference/utterdark-dm-sheet.csv`, the "Player Reference" tab). Create a game with **Start from: Descent into the Utterdark** to get a copy you can edit freely.

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
- **Free actions:** the full list from the sheet. A setting allows one free action per unit per turn.
- **Population** is a new resource. Train Population turns 100 Growth into +1 Population, and disbanding a healthy unit refunds 1.
- **Diplomatic agreements** are in the rules text.

## Still placeholders

Marked **PLACEHOLDER** in the app. The DM sheet tab didn't include them:

- every roll table: Excavate, Extract, New Region, Hunter's Post, Divine Intervention, Race, Loot, Encounter, Dungeon, Explore, Spy, Tavern, Turn Event, Economy Deficit;
- races and their bonuses;
- items, augments and recipes;
- starting resources;
- the CR cost table.

## Choices made

| Topic | Choice |
|---|---|
| Upgrade Settlement | Not on the sheet's action list, but kept, because settlements need a way to grow past Outpost |
| Teleport | 50/25/15/10 (the later, more detailed version) |
| Heal Unit | 5 HP per Gold or 10 HP per Food |
| Population per race | The sheet says Train Population gives "+1 population of base race". For now Population is one shared resource; per-race tracking can come with the recruit rules in Phase 5. |

## Rules the app shows as text (the DM handles them)

Defender's movement restriction, Vigilant, Tend Nature, Healer/Lifebringer free heals, Survivalist's Hunter's Post assist, Assassinate, Inspiration, Improviser, Song of Rest, Beast Bond damage redirection, Hunter's Mark, Tracker, Second Wind, Inspiring Leader, Grim Harvest, Profane Ritual, Tinker, Wildshape, Bound, Undead/Construct healing costs, Breeding Pits, the Menagerie release, and the out-of-combat spells (Plant Growth, Scry, Teleport, Reincarnate, Resurrection, True Resurrection, Wish). Fights list the combat-only ones under "Not automated" so the DM can account for them.
