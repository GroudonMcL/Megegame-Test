# Combat (DM guide)

Fights are simulated by the app and shown to you on the **Resolve round** tab, where you can check, change or replace them before you accept. The rules are D&D 5e, simplified so that a unit (a group of creatures with one stat block) fights as one.

## When a fight starts

- **Monsters attack anyone who walks in.** A Move (normal or force march) stops at the first region on its path with wild monsters, and the units fight them there. If all the monsters there are hidden, they roll Stealth against the movers' best passive Perception; if they all succeed, they ambush (surprise).
- **Stealthy moves** only fight monsters that spot them (see STEALTH.md). Searching for hidden units can also start a fight with hidden monsters.
- **Teams only fight each other through an Attack order.** Units of different teams can share a region peacefully. The Attack order names one target; its whole team's units in that region (those out in the open) defend together.
- **Capture Monster** is an Attack on a monster that tries to capture it instead of killing it (see below).
- Attacking with units that are all **hidden** is a surprise attack: advantage on initiative and on each unit's first attack. The attackers are revealed.
- Hidden defenders stay out of the fight.

Only the units named in the order fight on the attacking side.

## How a fight runs

1. **Initiative:** d20 + DEX modifier (+ initiative bonuses). Units act in that order each combat round.
2. **On its turn** a unit does one thing:
   - **Heal** an ally below half HP (or bring back a fallen one), if it can.
   - On its **first turn**, **buff** its strongest ally, if it can.
   - Otherwise, whatever is expected to do the most damage or harm: its Multiattack, a single attack, a damaging spell or breath weapon, or a disabling spell.
   - It also uses a damaging **bonus action** if it has one. Monsters with **legendary actions** use them at the end of each round.
3. **Targets:**
   - Weapon attacks go for the weakest enemy (lowest HP) they can hurt.
   - Damage spells, breath weapons and other save effects go for the toughest enemy (highest HP).
   - Disabling effects go for the most dangerous enemy.
   - You can pin a **focus target** for each side ("Blue Team focus on…"). An Attack or Capture order automatically focuses on its target.
4. **Attacks:** d20 + to-hit against AC. A natural 20 is a critical hit (dice doubled); a natural 1 misses. Resistance halves damage, vulnerability doubles it, immunity cancels it.
5. **Saving throws:** d20 + save bonus against the DC, for full, half or no damage as the stat block says. "Con/Dex save" uses the better of the two.

## Area effects

A unit takes up a square whose width depends on the creature's size:

| Size | Tiny | Small | Medium | Large | Huge | Gargantuan |
|---|---|---|---|---|---|---|
| Width | 7.5 ft | 15 ft | 30 ft | 60 ft | 90 ft | 120 ft |

You can change these in the ruleset's Settings. The area's width is its diameter (sphere, cylinder, emanation), side (cube) or length (cone). Damage is rolled once, then:

- the **first unit** takes normal damage plus (area width ÷ its width), at most double;
- the width that's left over hits **further units** one after another: normal damage for each unit it fully covers, and a share for a unit it partly covers.
- **Lines** are only 5 ft wide, so they hit units one after another along their length, each for normal damage, with no bonus.

| Example against Medium units | Result |
|---|---|
| Burning Hands (15 ft cone) | first unit 1.5× |
| Fireball (20 ft radius = 40 ft) | first unit 2×, a second unit ⅓× |
| Cone of Cold (60 ft cone) | first unit 2×, a second unit 1× |
| Dragon breath (90 ft cone) | first unit 2×, two more units 1× |
| Lightning Bolt (100 ft line) | three units 1×, a fourth ⅓× |
| Fireball against a Large unit | that unit 1⅔×, nothing else |

## Conditions

| Condition | In the simulation |
|---|---|
| Poisoned, Frightened | the unit has disadvantage on attacks |
| Blinded, Restrained | disadvantage on its attacks; attacks against it have advantage |
| Prone | attacks against it have advantage |
| Incapacitated, Stunned, Paralyzed, Unconscious, Petrified, Charmed | the unit's damage is cut by how badly it failed the save: by 1–4 → −50%, by 5–9 → −75%, by 10 or more (or a natural 1) → it loses its turns |

A disabled unit re-saves at the end of each of its turns. A success ends the effect; a failure multiplies what's left of the penalty by the same scale (−50% then failing by 1–4 again → −25%). It also ends when its duration runs out, and damage wakes an Unconscious unit.

## Abilities the app understands

- **Uses:** at will, X per combat, recharge (rolled at the start of each turn), and "X per day", which resets every game round. A unit that fights twice in one round has fewer spells in the second fight.
- **Spells** a unit gets from its archetype or items, the game's own spell list, and about 35 common SRD spells that monsters cast (Fireball, Cone of Cold, Hold Person, Cure Wounds…). Spells that don't matter in a fight (Fly, Detect Magic…) are skipped.
- **Traits by name:** Magic Resistance, Pack Tactics, Regeneration, Sneak Attack, Martial Advantage, Legendary Resistance, Uncanny Dodge, Undead Fortitude.
- **Effects** from races, archetypes, items, buildings and the region: bonuses to AC, to-hit, damage, damage dice, extra attacks, save DCs, saves and initiative, advantage and disadvantage, each with their conditions ("in the first round", "when allies outnumber enemies", "in a fortified region you control", "while force-marching"…). Fortifications count for the region owner's units; Defenders get double.
- **Reactive effects:** halve or reduce damage (N times per round or combat), turn a failed save into a success, lifesteal, and raising a slain enemy as an allied unit (it joins the next round).
- **Force-marching** units have disadvantage on attacks and saves.

Anything else (an ability with only text, or a trait the app doesn't recognise) is listed under **Not automated** on the fight, so you can judge whether it would have changed the result.

## How a fight ends

- **Retreat:** a team's unit below **25%** of its max HP retreats at the start of its turn: back to the region it came from, or a neighbouring region its team owns, or any neighbour. Monsters fight to the death. The threshold is in Settings (0 = never retreat).
- **Capture:** in a Capture Monster fight, once the monster is below a quarter of its HP and is the only enemy left, each attacking unit tries to capture it instead of attacking: the monster makes a STR or DEX save (its better one) against 8 + the unit's STR modifier + proficiency. A unit with advantage on capture checks (the Beastmaster) gives the monster disadvantage. A captured monster belongs to the capturing team, with the status **captured**, in that region.
- The fight also ends when one side has nobody left, or after the **maximum number of rounds** (Settings, default 10), with no winner.
- Units at 0 HP **die** and stay on the map as corpses that can be harvested.

## Loot

When a unit dies in a fight, everything it **carries** (the DM gives monsters items when placing them) and everything it has **equipped** (team units too) becomes loot for the winning side (`fightLoot` in `src/engine/combat/fight.ts`).

- **Who wins it:** the teams with a unit still **standing** on the winning side at the end. Retreated units don't count. Usually that's one team; it can be several when a team moved a unit lent to it by another team into the fight.
- **One team:** the loot goes into its inventory when you accept the order.
- **Several teams:** the fight card shows the loot and two choices:
  - **Split it between them now:** set how many of each item each team gets. Each item's shares must add up to how many there are; until they do (or if the fight changes after a re-roll or an edit), everything goes to the team that gave the order. Accepting puts each share into that team's inventory.
  - **Send them a note to share it out themselves:** edit the suggested note; accepting sends it to each of those teams' Messages (as a DM note). The loot isn't added to anyone's inventory; give it out by hand from View as team › Inventory once they agree. Undoing the order doesn't unsend the note.
- **Nobody wins** (the monsters win, or the round limit is reached): the gear stays on the fallen. You can see and change it in the unit's editor on the World map.
- Either way, the dead units lose what was taken from them.
- The loot is listed in the **fight log** (💰) and in each team's **results**. A team whose lent unit fought gets a report of its share.

## Your controls on each fight

- **The fight card** shows every unit's HP before and after, what happened to it, the abilities that aren't automated, and the round-by-round log.
- **Re-roll** runs the whole order again with new dice.
- **Show odds** runs the fight 200 times (Settings) and shows each side's chance of winning, the units it tends to lose and the HP it keeps.
- **Focus on** pins a target for a side. **Resolve by hand** skips the simulation: the move still happens, and you set HP and statuses on the World map.
- **Edit results by hand** lets you set any unit's final HP and whether it's standing, retreated or dead. The log notes your change. A re-roll clears these edits.
- **Show the log to the teams** (on by default): both sides see the round-by-round log on their Results page. The defending team gets an "Attacked" report even though it gave no order.
- **Loot** (several winning teams only): split it or send a note (see above).
- Click **Apply these settings** after changing any of these. The fight is worked out again with the same dice. A re-roll clears the loot split too.
- As with every order, accepting re-runs the fight with the same dice against the game as it is now, and **Undo last** reverses it.
