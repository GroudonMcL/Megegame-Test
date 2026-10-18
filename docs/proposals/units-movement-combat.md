# Proposal: stat blocks, map movement and combat

Status: **draft, waiting for decisions.** Nothing in this document has been coded yet.
Questions are marked **❓** and summarised at the end.

---

## 1. Stat blocks

Every unit type, monster and hero uses a **full D&D 5e stat block**. The same shape is used for:

- the DM's own homebrew units (Utterdark's Regiment, Guard and so on);
- monsters imported from the SRD (the free, openly licensed D&D rules content);
- the "effective" stat block of a recruited unit after race, academy and augment bonuses.

### What a stat block holds

| Part | Contents |
|---|---|
| Header | name, size, creature type (+ tags like Humanoid, Beast, Undead), alignment, CR, proficiency bonus |
| Defences | AC (+ note, e.g. "chain mail"), hit points (average + hit-dice formula), saving-throw proficiencies, skills, damage vulnerabilities / resistances / immunities (with "from nonmagical attacks" where relevant), condition immunities |
| Movement | walk, fly, swim, climb and burrow speeds in feet, plus hover |
| Senses | darkvision, blindsight, tremorsense, truesight, passive Perception (always derived: 10 + Wisdom modifier + proficiency if proficient) |
| Ability scores | STR, DEX, CON, INT, WIS, CHA. Modifiers are always calculated from the scores, so a race's +2 STR changes everything that uses STR. |
| Traits | e.g. Magic Resistance, Pack Tactics, Regeneration, Legendary Resistance (3/day) |
| Actions, bonus actions, reactions, legendary actions | see below |
| Megagame fields | category (standard / hero / monster / leader), recruit cost, upkeep, vision range, unlocked actions (e.g. Miner → Excavate), materials it can be harvested for |

### Actions are stored twice: as text and as data

Each action keeps its **original text** (what players read) plus a **combat profile** (what the app uses):

- **Attack**: to-hit bonus, *which ability it uses* (so +2 STR from a race changes the to-hit and damage), melee or ranged, and damage dice with damage type, e.g. `1d8 + STR slashing` plus `1d6 fire`.
- **Saving-throw effect**: save ability, DC (and which ability sets it), damage on a fail, what happens on a success (half damage / none), condition applied, and number of targets.
- **Heal**, **buff ally**, **debuff enemy**: same idea.
- **Multiattack**: which attacks, and how many of each.
- **Uses**: at will, X per day, recharge 5–6, X per combat.

If the app can't understand an action, it's marked **"text only"** and shows a warning on the combat card, as the original spec says.

### Importing from the SRD

There are two editions of the free D&D rules content, and the app would include the monsters from either:

| | SRD 5.1 (2014 rules) | SRD 5.2 (2024 rules) |
|---|---|---|
| Monsters | 334 | 341 |
| Spellcasters | spell-slot lists (e.g. Mage: 4×1st, 3×2nd…), harder to automate | mostly "Fireball 2/day" plus a strong main attack (e.g. Mage: Arcane Burst ×3), much easier to automate |
| Licence | CC-BY 4.0 (free to use with a credit line) | CC-BY 4.0 |

About two-thirds of all monster actions come with their numbers already in data form: to-hit, damage dice and type, save DC, recharge. The rest (mostly odd special abilities) come in as text. The import screen shows those so the DM can fill in a combat profile or leave them as text only.

Only 114 different spells appear in SRD monster stat blocks, and most are non-combat (Detect Magic, Invisibility, Scrying…). I'd hand-map the **~40 combat-relevant ones** (Fireball, Hold Person, Cure Wounds, Bless, Sleep…) to the effect primitives. Others are text only.

**❓ Q1: which SRD edition?** I recommend **2024 (SRD 5.2)** because its monsters are designed to be run quickly, which suits automation. Both is possible, but monster names collide (e.g. two different "Mage"s).

### Utterdark's own units

SRD creatures and Utterdark units are balanced very differently:

| | Utterdark | SRD 2024 |
|---|---|---|
| Guard | AC 16, 24 HP | AC 16, 11 HP (CR 1/8) |
| Mage | AC 10, 28 HP, 1d6+INT | AC 15, 81 HP, 3 × 3d8+3 (CR 6) |
| Scout | 4 regions of movement | 30 ft, same as everyone |

**❓ Q2: what should the Utterdark preset's player units be?**

- **(a) Convert** each Utterdark unit into a full stat block that keeps its current numbers and abilities, adding speed, saves, damage types and so on. Your costs and upkeep stay balanced. *(my recommendation)*
- **(b) Replace** each with the nearest SRD creature (Regiment → Warrior Veteran, Healer → Priest Acolyte, Champion → Gladiator…) and rebalance costs.
- **(c) Mix**: SRD where there's a good match, converted Utterdark stats for the rest.

### Player customisation

When recruiting, the player picks the **race** (from the races their team has). If the building is an **Academy**, its +2 bonus is added. Augments are applied later with the Apply Augment free action.

The unit screen shows the **effective stat block**, with every bonus shown and where it came from, e.g. `To hit +7 (STR +4, proficiency +2, Fortification +1)`. The base stat block is never changed; bonuses are layered on top, so removing an augment is always clean.

---

## 2. Map movement

Following D&D overland travel:

- Each **connection** between two regions has a **length in miles** and a **terrain**. The DM picks the terrain from a list they control, e.g. *Normal*, *Difficult*, *Water (needs swim or fly)*, *Sheer (needs climb or fly)*.
- A unit's **travel per day** = 24 miles × (walk speed ÷ 30 ft), so a 30 ft creature covers 24 miles a day, as in D&D's normal pace. Flying units use their fly speed if it's faster.
- **Difficult terrain** costs double. It's ignored by flying units, and by **any group travelling with a unit that has the "Natural explorer" effect** (e.g. a Ranger). In D&D, a ranger's favoured terrain doesn't slow their *group*, so units picked up along the way benefit too.
- The game setting **travel days per round** turns that into a per-round budget. *Example:* 1 travel day per round, with connections 12 miles long by default, means a 30 ft unit moves 2 normal regions per round, just like Utterdark.
- **Force march** doubles the budget (with disadvantage), and **Stealth** halves it, as in Utterdark. Both multipliers are DM settings.
- The path picker on the map shows only the regions the unit can reach with the miles it has left this round.

I'm not asking about this part: the numbers are all settings, so nothing is locked in. One consequence: if you choose (a) above, the Scout's "4 regions" becomes a 60 ft walking speed.

---

## 3. Combat (to be built in Phase 6; nothing coded until you agree)

"Baseline" automation, played in initiative order:

1. **Initiative**: d20 + DEX modifier. A side ambushing from stealth gets advantage on initiative and on its first attacks.
2. **Each unit's turn**: the unit picks an action using the simple targeting rules from the spec. Attackers hit the weakest enemy they can damage. Damage casters hit the toughest enemy, or groups. Healers heal allies below 50% HP. Buffers buff the strongest ally on their first turn. The DM can pin a priority target beforehand.
3. **Attacks** use the full Multiattack: d20 + to-hit vs AC, with advantage or disadvantage. A natural 20 is a critical (dice doubled). Resistance halves damage, vulnerability doubles it, immunity cancels it.
4. **Saving-throw effects**: d20 + save bonus vs DC, for full, half or no damage as the stat block says.
5. **Conditions are simplified to advantage/disadvantage:**

   | Condition | Effect in the simulation |
   |---|---|
   | Poisoned, Frightened | the unit has disadvantage on attacks |
   | Blinded, Restrained | the unit has disadvantage on attacks; attacks against it have advantage |
   | Prone | attacks against it have advantage |
   | Grappled, Deafened | no effect |
   | **Incapacitated, Stunned, Paralyzed, Unconscious, Petrified, Charmed** (anything that removes a unit from the fight) | **the unit's damage that round is cut by an amount based on how badly it failed the save** (see Q3) |

6. **Uses**: recharge abilities roll each turn, X/day abilities are counted, Legendary Resistance turns a failed save into a success, and legendary actions become extra actions at the end of the round.
7. **Common traits are understood by name**: Magic Resistance, Pack Tactics, Regeneration, Martial Advantage, Sneak Attack, Uncanny Dodge and so on. Anything else shows a "text only" warning.
8. **The fight ends** when one side is wiped out, a retreat condition triggers, or the DM's maximum number of rounds is reached.
9. **Output**: a readable round-by-round log, final HP, deaths and corpses. The DM can re-run it, edit it or replace it.

### ❓ Q3: "removed from combat" effects

You suggested −50% damage, "or more depending on the degree of success of the saving throw". My suggestion:

| Save result | Effect on the target's next turn |
|---|---|
| Succeeds | none |
| Fails by 1–4 | deals −50% damage |
| Fails by 5–9 | −75% |
| Fails by 10+ or rolls a natural 1 | −100% (loses the turn) |

The effect lasts **one turn**, then wears off. This ignores D&D's "repeat the save each turn" to keep things simple.

### ❓ Q4: rolled dice or averages?

- **Rolled** *(recommended)*: real dice with a stored seed, so results vary but can be reproduced, plus a **"Show odds"** button that runs the fight 500 times and reports, for example, "Side A wins 72%, average 2 units lost".
- **Averages**: no randomness; every hit does its average damage, weighted by the chance to hit. Fully predictable, but no lucky upsets.

### ❓ Q5: area effects (Fireball, breath weapons)

Units are groups, so how many enemy *units* can an area effect hit? My suggestion: by area size, ≤10 ft → 1 unit, 15–20 ft → 2 units, 30 ft or more → 3 units.

### ❓ Q6: when do "X per day" uses come back?

- **Each game round** *(recommended)*: one round is about a week of game time. A unit that fights twice in one round has fewer spells left in the second fight.
- **Each combat**: simpler; every fight starts fresh.
