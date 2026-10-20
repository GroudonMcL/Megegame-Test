import type { Metadata } from "next";
import { B, Guide, K } from "../Guide";

export const metadata: Metadata = { title: "DM guide" };

export default function DmGuide() {
  return (
    <Guide
      title="DM guide"
      other={{ href: "/help/player", label: "Player guide" }}
      intro={
        <p>
          Setting up a game, running each round and keeping a routine round of six teams well under an hour. Everything here happens under <B>DM login</B> on the home page. Your
          players have their own <a href="/help/player" className="text-link underline">player guide</a>.
        </p>
      }
      sections={[
        {
          id: "setup",
          title: "Setting up a game",
          body: (
            <ol>
              <li>
                On the DM dashboard, give the game a name, choose what to <B>Start from</B> (a preset such as Utterdark, or Blank) and press <B>Create game</B>. The game gets its own copy of
                the rules, so changing one game never changes another.
              </li>
              <li>
                <B>Ruleset</B>: check and edit resources, buildings, units, actions, items, recipes, roll tables and game settings. Problems (like an action pointing at a table that
                doesn&apos;t exist) are listed on the Teams page and the Ruleset page. <B>Import / export</B> saves or loads the whole ruleset as a file.
              </li>
              <li>
                <B>Map editor</B>: <B>Upload map image</B>, set the <B>Scale</B> (type the miles across the map, or use <B>Measure scale</B> on a scale bar), then <B>Draw region</B>: click
                its corners on the image; they snap to nearby corners and edges and follow a neighbour&apos;s border, so regions fit together. Regions that touch (along an edge or at a corner)
                are neighbours automatically. <B>Edit shapes</B> drags corners (a shared corner moves in every region) and adds or removes them; press <B>Save shapes</B> when done.{" "}
                <B>Draw terrain</B> adds forest, swamp or water areas over the regions: the part of a move inside one follows its terrain type&apos;s rules. <B>Link</B> joins regions that
                don&apos;t touch (tunnels, sea lanes). In <B>Select</B>, click a region to name it, set its owner, settlement, buildings, deposits, ruins and hazards, mark it hidden, move
                its centre (where its name and new units go), and block or hide its border with each neighbour. You can also import regions from a spreadsheet, then use{" "}
                <B>Fill in starting shapes</B>.{" "}
                <B>3D &amp; light</B> sets how the map looks in 3D: upload a greyscale <B>height map</B> the same shape as the map (white = highest), choose how tall it&apos;s drawn,
                and set the lighting: the sun&apos;s colour, direction, height and brightness, the sky light, whether hills cast shadows, and <B>Darkness</B> for night (it darkens the
                2D map too). The preview shows changes at once; <B>Save look</B> shows them to everyone. Players only get the heights of regions they&apos;ve seen.
              </li>
              <li>
                <B>Teams</B>: add each team. Open <B>Edit team</B> to set its colour, emblem, base race, other races, starting resources and secret objectives. Each new team gets an unused emblem; teams are shown by emblem as well as colour so colour-blind players can tell them apart. Tick <B>DM-run (NPC)</B> for factions you play
                yourself. Give each team its <B>join code</B>; <B>New code</B> replaces it and signs everyone on that team out.
              </li>
              <li>
                <B>World map</B>: the screen behind <B>Teams</B>, <B>Resolve</B>, <B>Diplomacy</B> and <B>Messages</B>, which open as windows over it (move, resize or maximise them; × or <B>Esc</B> closes
                them). Click a region and use <B>Place units here</B> to add team units and wild monsters, with their archetype and anything they <B>carry</B> (items and
                how many: loot for whoever kills them). Click a unit to change its HP, status, owner, race, archetype, what it carries, or notes. Click a unit badge to open a menu of every unit standing there; tick units in it, then drag the badge to move them (with none ticked, the whole
                stack goes). You can drop units anywhere: borders never stop your moves. Wild monsters move straight away. For a team&apos;s units you choose <B>Instant change</B>
                (moved now, no miles used, no fight; logged and undoable from the message on the map or the team&apos;s DM log) or <B>Add as a move order</B> (added to the team&apos;s
                orders for this round and resolved like its own moves; borders don&apos;t stop it, but it only goes as far as the units&apos; miles allow, and the team can&apos;t make
                its own moves cross borders this way: if they change it, it becomes a normal move; undo it from the team&apos;s DM log). Both offer <B>Send a note to the team</B>.
                You can drag units of several owners at once: wild monsters move straight away and every team&apos;s units go through the same choice.
                Units a team has lent to another say so in the side panel.
              </li>
              <li>
                <B>Settings &amp; export</B>: paste Discord webhooks for the public channel and each team&apos;s private channel, then <B>Send a test message</B>.
              </li>
              <li>
                Press <B>View as team</B> on the Teams page to see the player screens exactly as that team does, and to act for it (see <B>Editing as a team</B> below). Looking around
                never changes what the team remembers.
              </li>
            </ol>
          ),
        },
        {
          id: "round",
          title: "Running a round",
          body: (
            <>
              <ol>
                <li>
                  On <B>Teams</B>, set a deadline and press <B>Open round</B>. Discord gets a message. The page shows who has submitted; <B>Remind teams on Discord</B> nudges the rest.
                </li>
                <li>
                  At the deadline (or whenever you like), go to <B>Resolve round</B> and press <B>Start resolving</B>. This locks orders, and players keep seeing the world as it is now until
                  you publish.
                </li>
                <li>Work through the queue, one action at a time (below).</li>
                <li>
                  <B>Go to end of round</B>: production, upkeep, income, per-round rolls, hazards, deficits, random events and trades for every team. Adjust any numbers, untick teams that
                  shouldn&apos;t get an event, and press <B>Apply end of round</B>.
                </li>
                <li>
                  <B>Publish</B>. Teams see their results, Discord announces it, and you can open the next round.
                </li>
              </ol>
              <p>
                <B>↶ Undo last</B> takes back the most recent decision, all the way back to the start of resolving. Use it freely.
              </p>
            </>
          ),
        },
        {
          id: "queue",
          title: "The resolution queue",
          body: (
            <>
              <p>
                Orders are grouped into steps: every team&apos;s moves listed before its action 1, then every team&apos;s action 1, then the moves listed before action 2, then action 2, and so
                on, ending with the moves listed after the last action. Moving is a free action, so it never uses an action slot; other free actions and backups sit in their places.
                Moves in one step happen at the same time. Press <B>Prepare moves</B> (or <B>Prepare action 1</B>): the
                app checks each order against the world as it is now, moves units, rolls dice, looks up tables, runs fights and drafts the outcome text.
              </p>
              <ul>
                <li>
                  <B>Ready</B>: nothing left to decide. <B>Accept all ready</B> takes them all at once.
                </li>
                <li>
                  <B>Needs review</B>: there&apos;s a roll or a result in words; read it, then accept.
                </li>
                <li>
                  <B>Needs DM</B>: an improvised or manual action. Write the outcome and add any resources.
                </li>
                <li>
                  <B>Can&apos;t happen</B>: the order is no longer possible (the unit died, the money ran out). Mark it failed, which lets a backup order take over, or skip it.
                </li>
              </ul>
              <p>
                For each order you can edit the outcome text, add or take away resources, hide the rolls from the team, <B>Re-roll</B>, <B>Mark failed</B> or <B>Skip</B>. A ⚑ flag means
                orders meet: teams moving into the same region, targeting each other, or ending up next to monsters. Flagged orders get the same <B>scene</B> number so you can handle them
                together.
              </p>
              <p>
                Use the <B>Team</B>, <B>Action</B> and <B>Only flagged</B> filters to focus. <B>Show decided orders</B> brings back the ones you&apos;ve done.
              </p>
            </>
          ),
        },
        {
          id: "keys",
          title: "Keyboard shortcuts",
          body: (
            <>
              <p>In the Resolve window (not while you&apos;re typing in a box):</p>
              <ul>
                <li>
                  <K>j</K> / <K>k</K>: next / previous order (or click an order to highlight it)
                </li>
                <li>
                  <K>a</K>: accept the highlighted order and move to the next
                </li>
                <li>
                  <K>f</K>: mark it failed; <K>s</K>: skip it; <K>r</K>: re-roll it
                </li>
                <li>
                  <K>e</K>: edit its outcome text; <K>Esc</K> leaves the box
                </li>
                <li>
                  <K>Shift</K>+<K>A</K>: accept all ready orders in this action; <K>p</K>: prepare the next action
                </li>
                <li>
                  <K>?</K>: show the list on the page
                </li>
              </ul>
              <p>
                A quick round: <K>p</K>, <K>Shift</K>+<K>A</K>, then <K>j</K> and <K>a</K> through whatever&apos;s left; repeat for each action.
              </p>
            </>
          ),
        },
        {
          id: "fights",
          title: "Fights",
          body: (
            <>
              <p>
                When an order leads to a fight, the order shows a fight card: who took part, HP before and after, the winner and the full log. Fights use the units&apos; stat blocks.
                Area spells hit more units the bigger the area is compared to each unit&apos;s size, and units retreat when badly hurt. Anything the simulator can&apos;t handle is listed under
                <B> Not automated</B>, so check whether it would change the result.
              </p>
              <ul>
                <li>
                  <B>… focus on</B>: tell a side which enemy to attack first.
                </li>
                <li>
                  <B>edit results by hand</B>: set any unit&apos;s final HP or outcome yourself.
                </li>
                <li>
                  <B>resolve by hand</B>: skip the simulation and write the result.
                </li>
                <li>
                  <B>show the log to the teams</B>: share the full fight log, or keep it to yourself.
                </li>
                <li>
                  <B>Loot</B> (💰): whatever the units that died carried or had equipped goes to the teams with a unit still standing on the winning side. With one team, it goes into
                  its inventory when you accept. With several (a lent unit fought), choose <B>split it between them now</B> and set each team&apos;s share, or <B>send them a note to
                  share it out themselves</B>: the note goes to their Messages when you accept and nobody&apos;s inventory changes. If nobody wins, it stays on the fallen. It&apos;s
                  listed in the fight log and the teams&apos; results.
                </li>
                <li>
                  Press <B>Apply these settings</B> after changing any of these (the loot too). <B>Show odds</B> runs the fight many times to show how likely each result is.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "between",
          title: "Between rounds",
          body: (
            <ul>
              <li>
                <B>Diplomacy</B>: who has met whom (teams meet automatically when their units see each other), and every trade. You can mark teams as met by hand, or cancel a trade.
              </li>
              <li>
                <B>History</B>: charts of each resource for every team, and every past round&apos;s orders and results.
              </li>
              <li>
                <B>Settings &amp; export</B>: download the whole game as a backup file, or spreadsheets of teams, units, regions, orders, rolls and resources. The backup includes join codes,
                so keep it private.
              </li>
              <li>To change a team&apos;s resources or races outside a round, use <B>Edit team</B> on the Teams page. Every change is recorded in the game&apos;s log.</li>
            </ul>
          ),
        },
        {
          id: "edit-as-team",
          title: "Editing as a team",
          body: (
            <>
              <p>
                <B>View as team</B> opens the team&apos;s own screens with a bar saying <B>Editing as … (DM)</B>. You can do anything the team can: write and submit its orders (even
                after orders close, and past failed checks with <B>Bypass checks</B>), rename its units, and propose, accept, decline or call off its trades. <B>Back to DM</B> returns to
                your screens.
              </p>
              <ul>
                <li>
                  On <B>Units</B>, <B>Edit</B> on a unit also lets you change its <B>archetype</B> (teams only choose it when recruiting), and equip or unequip items at any time and
                  anywhere. If the unit doesn&apos;t meet an item&apos;s needs, <B>Equip anyway (DM)</B> skips them; the item still has to be in the team&apos;s inventory.
                </li>
                <li>
                  On <B>Inventory</B>, the <B>DM: edit items and recipes</B> panel lets you add or remove items, change quantities, and teach or make the team forget recipes. It shows the
                  live game, even during resolution when players still see the start-of-round picture.
                </li>
                <li>
                  Every change you make here offers <B>Send a note to the team</B>: tick it and the team gets a message from you in <B>Messages</B>, pre-filled with what changed
                  (&quot;The DM gave you 2× Iron Ingot&quot;). Edit the text as you like.
                </li>
                <li>
                  <B>DM log</B> (in the team&apos;s dock, or <B>DM changes and undo</B> in the bar) lists every change you made for this team. <B>Undo…</B> puts back what was there before,
                  unless something else has changed it since (the team edited its orders again, the item was used, the trade went ahead); then it says so and you can fix it by hand.
                  Order changes can only be undone until resolving starts.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "messages",
          title: "Messages",
          body: (
            <ul>
              <li>
                <B>Messages</B> on the World map lists every team, with a number for messages you haven&apos;t read and the latest one. Pick a team to read the conversation and reply. The
                number on the <B>Messages</B> button is the total unread.
              </li>
              <li>Everyone on a team sees its conversation and can write to you. Notes you send with changes show here too, marked <B>change note</B>.</li>
              <li>
                Inside <B>View as team</B>, the team&apos;s <B>Messages</B> window is the same conversation; what you write there comes from the DM. Reading it there doesn&apos;t mark
                anything read for the team.
              </li>
              <li>New messages turn up every 20 seconds while a conversation is open, or when you reload.</li>
            </ul>
          ),
        },
        {
          id: "secrets",
          title: "What players can and can't see",
          body: (
            <ul>
              <li>A team sees the regions it owns, regions where it has units, and regions its scouts and watchtowers can see. Regions it saw before stay on its map, dimmed, as they were. Regions next to the ones it sees show in greyscale with their name and terrain only; one further out shows as &ldquo;?&rdquo;; the rest isn&apos;t sent.</li>
              <li>Other factions&apos; units show only their type and owner, never HP or names. Hidden units stay invisible until spotted.</li>
              <li>Players never see roll tables&apos; contents, the monster library (except monsters they&apos;ve met), other teams&apos; resources, or your notes.</li>
              <li>The map image is fogged on the server, so nothing hidden ever reaches a player&apos;s device.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
