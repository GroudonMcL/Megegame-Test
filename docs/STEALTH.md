# Stealth, trades and Discord (DM guide)

## Hidden units

A unit with status **hidden** is invisible to every team that hasn't **spotted** it. The DM always sees it (marked on the World map).

**Who is watching a region.** Each other team with units there (hidden or not), wild monsters there, and the owner of a Watchtower in the region (or a tier 3 Watchtower next door). A side's **stealth DC** is the highest passive Perception among its units there, or its Watchtower's DC if higher. A Watchtower also gives stealthy enemies disadvantage.

**Moving by stealth** (Move Units – Stealth). For every region the units enter, each unit rolls Stealth (d20 + DEX + Stealth proficiency + bonuses) against every side watching it:

- If it beats a team's DC, that team doesn't see it.
- If it fails, that team **spots** it: the unit stays hidden from everyone else, but that team can see it (and attack it).
- If it fails against **monsters**, they attack: the move stops there and there's a fight.
- At the end of the move the units are **hidden**. Their old "spotted" marks are cleared: they've slipped away, apart from the teams that spotted them on this move.

**Other ways to lose cover.** A hidden unit that moves normally (or force-marches), attacks, or fights is revealed. The DM can also change a unit's status on the World map.

**Hidden monsters** placed by the DM stay hidden until found. A team that walks into their region (normal move) fights them. If every monster there is hidden, they roll Stealth against the movers' best passive Perception, and if they all succeed they ambush with surprise.

**Searching** (Search → Hidden units). The searching units' best Perception (d20 + WIS + Perception proficiency) is rolled against each hidden unit's passive Stealth (10 + its Stealth bonus). A team's unit that's found is spotted. Found monsters attack.

Every Stealth and Search roll is shown on the order in the resolution queue, with the DC and where it came from.

## Meeting and trading

**Teams meet** when, at the end of a round, their units are in the same region and at least one side can see the other's (out in the open, or spotted). The DM can also mark or remove contact on the **Diplomacy** page.

**Trades.** On the player **Trades** page, a team offers any mix of resources, items, recipes it knows, races it has gained (not its base race), units, regions and a copy of its map, and asks for resources, items and/or the other team's map (anything else goes in the message). The other team accepts or declines; either side can call it off until it happens.

Accepted trades happen **at the end of the round**, after income and upkeep, in the order they were accepted. A trade only goes through if both sides still have what they offered; otherwise it fails and both teams are told why. You see them in the end-of-round review, and every trade on the **Diplomacy** page, where you can call one off.

A **map** in a trade gives the other team every region the giver has found or seen (shown dimmed, as last seen) and the hidden passages it knows.

## Discord

On **Settings & export**, paste a Discord webhook URL for the game's public channel and, if you like, one for each team's private channel. **Send a test message** checks them.

| When | Where | Message |
|---|---|---|
| You open a round | public | the round is open, with the deadline |
| You click **Remind teams on Discord** (Teams page) | public | the deadline and the teams that haven't submitted |
| Once a day, if a deadline is less than 24 hours away | public | the same reminder (once per deadline) |
| You publish a round | public | the round has been resolved |
| You publish a round | each team's channel | "your results are ready", with the resource changes and a link |

If Discord can't be reached, the game carries on; the failure is noted in the audit log.

## Random events

At the end of each round the **Random events** box in the review rolls the event table (category "event"; in Utterdark, the Turn Event table) for the teams you tick. Utterdark ticks every team by default. A table can add +1 per N regions a team owns.

## History and export

- **History**: a chart of each resource over the rounds for every team (with a table view), and any team's orders and outcomes for any published round.
- **Settings & export**: download the whole game as JSON (a full backup, including join codes and the map image: keep it private), or CSV sheets of teams, units, regions, orders, the roll log, and resources by round.
