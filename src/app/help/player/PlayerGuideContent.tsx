import { B, Guide } from "../Guide";

// The player guide's text: shown as its own page (/help/player) and in the Help window in the game.

export function PlayerGuideContent({ embedded = false }: { embedded?: boolean }) {
  return (
    <Guide
      embedded={embedded}
      title="Player guide"
      other={{ href: "/help/dm", label: "DM guide" }}
      intro={
        <p>
          How to join your team, read the map, give orders each round and see what happened. The exact actions, resources and units depend on the game your DM is running; the{" "}
          <B>Rules</B> page in the app always shows this game&apos;s rules.
        </p>
      }
      sections={[
        {
          id: "join",
          title: "Joining your team",
          body: (
            <>
              <ol>
                <li>Open the game&apos;s web address on your phone or computer.</li>
                <li>
                  Type the <B>join code</B> your DM gave your team (like <code>K7QM-2XRD-HP4W</code>; capitals and dashes don&apos;t matter) and your own name, then press <B>Join team</B>.
                </li>
                <li>You stay signed in on that device. Everyone on your team uses the same code and sees the same screens.</li>
              </ol>
              <p>
                If you&apos;re suddenly sent back to the join screen, the DM has probably given your team a new code. Ask them for it. <B>Leave</B> (top right) signs you out of this device.
              </p>
            </>
          ),
        },
        {
          id: "round",
          title: "How a round works",
          body: (
            <>
              <ol>
                <li>
                  The DM <B>opens a round</B>, usually with a deadline. The deadline counts down on your <B>Orders</B> page.
                </li>
                <li>Your team plans its orders together and someone presses <B>Submit orders</B>.</li>
                <li>At the deadline the DM locks orders and works through everyone&apos;s actions in order: every team&apos;s action 1, then every team&apos;s action 2, and so on.</li>
                <li>
                  When the DM <B>publishes</B> the round, your <B>Results</B> page shows what happened, and the map, units and resources update. Until then, you keep seeing the world as it was when
                  resolving started.
                </li>
              </ol>
            </>
          ),
        },
        {
          id: "screens",
          title: "The screens",
          body: (
            <>
              <p>
                The map is always on screen. The bar along the top shows your team, the round, its deadline, whether your orders are submitted, and your resources. The buttons down the left (along
                the bottom on a phone) open each screen as a window over the map: drag a window by its title to move it, drag its edge or corner to resize it, or use the square button to make it fill
                the screen. Close it with × or <B>Esc</B>, or press its button again. Each window opens where you last left it.
              </p>
              <ul>
                <li>
                  <B>Overview</B>: your resources, the round&apos;s deadline, your latest results and your faction&apos;s secret objectives (only your team sees these).
                </li>
                <li>
                  <B>The map</B>: tap a region, or a unit badge, to see what you know about it in a panel on the right (<B>Esc</B> or × closes it). Your own units show
                  everything; other sides&apos; units show only their type and owner. Under <B>Give an order</B>, pick an order (for a unit: <B>Move</B> and the rest) and your
                  Orders window opens with it already filled in, ready to finish and save. <B>Show on map</B> in the Units and Regions windows takes you to that place. <B>Map key</B> in the corner explains the symbols. <B>2D / 3D</B> in the bottom corner shows the map as terrain you can turn and tilt (drag to move, right-drag or two fingers to turn, scroll or pinch to zoom); everything works the same in both. If 3D runs slowly on your device it switches back to 2D. Regions you can see now are clear; regions you&apos;ve only seen before are greyed and show what was there last time;
                  the rest is hidden. Each team has a colour and an emblem (a shield, crown, tower…), so you can tell teams apart without relying on colour. Unit badges show the owner&apos;s
                  emblem and how many units are there; your own have square corners.
                </li>
                <li>
                  <B>Units</B>: every unit you own, where it is, its hit points, movement left and full stat block. Tap a unit&apos;s name to rename it.
                </li>
                <li>
                  <B>Regions</B> and <B>Inventory</B>: the regions you hold, their buildings and income, and the items and materials you carry.
                </li>
                <li>
                  <B>Trades</B>: offers to and from factions you&apos;ve met.
                </li>
                <li>
                  <B>Rules</B>: actions, buildings, units, items, recipes and the monsters you&apos;ve met, for this game.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "orders",
          title: "Giving orders",
          body: (
            <>
              <p>
                On <B>Orders</B>, choose <B>Add an action…</B> and fill in what it needs (units, a target, a path, a building…). The app checks each order as you go and marks problems in red,
                for example a unit that can&apos;t move that far or a building you can&apos;t afford.
              </p>
              <h3>Three kinds of order</h3>
              <ul>
                <li>
                  <B>Numbered actions</B> use one of your action slots for the round (shown at the top, e.g. 4/6). They happen in the order you list them.
                </li>
                <li>
                  <B>Free actions</B> don&apos;t use a slot. They happen where you put them in the list.
                </li>
                <li>
                  <B>Backups</B> only happen if the action just above them fails, for example &ldquo;if the attack fails, retreat&rdquo;.
                </li>
              </ul>
              <h3>Moving</h3>
              <p>
                The quickest way is on the map: drag one of your unit badges to where it should go (press <B>Shift</B> on the way to add a bend). The line shows the miles it uses
                out of what&apos;s left, and turns red with the reason if the move can&apos;t happen; letting go then does nothing. Otherwise it queues a Move order (asking which kind of
                move if there&apos;s a choice) and saves your draft. Drop units where a move of yours from the same region already ends and they join it, without using another action.
                On a phone, or to move one unit out of a stack, tap the unit and choose <B>Move on map</B>, tap the stops, then <B>Done</B>. Planned moves are drawn on the map, with a
                see-through badge where the units will end up (drag that to plan their next move); tap a route to redraw or cancel it.
              </p>
              <p>
                In the Orders window, pick the units, then <B>Draw route on map</B> and tap the map to add stops: your units walk in straight lines from stop to stop. The miles come from the map&apos;s scale; the
                part of the route through difficult terrain costs more, and water needs swimming or flying. A route can only cross into a neighbouring region (not through a blocked border), but
                it can go on into ground you can&apos;t see: your units go as far as they can, and the DM checks the rest. Units that move together go at the speed of the slowest, and each
                unit&apos;s miles for the round are shared between all its moves.
                Moving into a region with other factions&apos; units or monsters can start a fight, so say in the notes how you avoid it if you want to. Stealthy moves try to slip past unseen.
              </p>
              <h3>Notes and the projection</h3>
              <p>
                Each order has a box for <B>flavour and notes for the DM</B>: describe how you do it. The <B>Projection</B> shows your resources after this round&apos;s costs, upkeep and
                income, so you can see if you&apos;ll run short.
              </p>
              <h3>Saving and submitting</h3>
              <ul>
                <li>
                  <B>Save draft</B> keeps your plan without sending it. The DM can see drafts, but treats them as not submitted.
                </li>
                <li>
                  <B>Submit orders</B> sends them. You can still change them until the deadline, but then you must submit again.
                </li>
                <li>If a teammate saved changes since you opened the page, saving tells you to reload the page first, so nobody overwrites anyone else.</li>
              </ul>
            </>
          ),
        },
        {
          id: "results",
          title: "Results, fights and rolls",
          body: (
            <>
              <p>
                <B>Results</B> lists each of your orders with what happened, any dice rolled (unless the DM hides them), resources gained or spent, and the end-of-round summary: upkeep,
                income, random events and trades. Earlier rounds are there too.
              </p>
              <p>
                Fights are worked out automatically, round by round, using each unit&apos;s stat block. Units retreat when badly hurt. If your units were attacked, the report says by whom and how
                it went. The DM may share the full fight log.
              </p>
            </>
          ),
        },
        {
          id: "stealth",
          title: "Hiding, searching and spying",
          body: (
            <ul>
              <li>A stealthy move rolls against the best watcher in each region you enter. If you&apos;re spotted, that faction can see and attack your units; monsters that spot you attack.</li>
              <li>Hidden units stay hidden until they move openly or attack.</li>
              <li>
                <B>Search</B> looks for things in a region, including hidden units. Spying and other information actions can show you regions you can&apos;t normally see.
              </li>
            </ul>
          ),
        },
        {
          id: "trades",
          title: "Meeting other factions and trading",
          body: (
            <>
              <p>
                You meet a faction when your units and theirs see each other in the same region. After that, they appear on <B>Trades</B>.
              </p>
              <ol>
                <li>
                  Choose who to trade with, what <B>you give</B> and what <B>you ask for</B>, add a message if you like, and send it.
                </li>
                <li>The other team accepts or declines. Either side can call it off until it happens.</li>
                <li>Accepted trades happen at the end of the round. If either side no longer has what it promised, the trade fails and both teams are told why.</li>
              </ol>
              <p>You can offer resources, items, recipes, races, units, regions or a copy of your map. You can ask for resources, items or a map; ask for anything else in the message.</p>
            </>
          ),
        },
        {
          id: "phone",
          title: "Tips",
          body: (
            <ul>
              <li>Everything works on a phone. On the map, pinch to zoom and drag to look around.</li>
              <li>The app is dark by default. The sun button at the top switches to the light theme (and the moon switches back); this browser remembers your choice.</li>
              <li>If your DM set up Discord, your team&apos;s channel gets a message when results are ready, with a link straight to them.</li>
              <li>Stuck? Ask your DM. They can look at exactly what your team sees.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
