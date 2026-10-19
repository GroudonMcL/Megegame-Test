# Proposal: UI overhaul

Status: **approved**. Phases 1–4 are built: theme, layout shell, click-to-inspect, and regions (shapes, measured movement, map editor).

The app becomes map-first: the map is always on screen and everything else opens on top of it. Later phases replace map nodes with drawn regions, add drag-to-move with drawn paths, an optional 3D map, and a simpler phone view.

## Decisions so far

| # | Question | Decision |
|---|---|---|
| D1 | Branch | Work on the session branch and push each finished step to `uioverhaul` too. |
| D2 | Which screens get the map shell | **All player screens** and the **DM World map** (with Resolve, Teams and Diplomacy as windows over it). The Ruleset editor, History and Settings stay as normal pages with the new theme. |
| D3 | Drag to move | A drop creates a **Move Units** order. A popup asks for normal, stealth or force march. A second unit dragged from the same place to the same place **joins** that order, so it doesn't use another action. |
| D4 | Distances | Units stand at **exact spots** inside regions. A move is a **line with several bends** (waypoints) that can cross several regions. Miles = line length × the **map scale**, which the DM sets in the map editor. The miles-per-round budget is unchanged, so a unit can move more than once a round. |
| D5 | Terrain | Difficult terrain becomes **overlay areas** drawn on top of regions. Only the part of a line **inside** an overlay uses its rule (×2 miles, needs a swim or fly speed, and so on). Flyers and Natural Explorer groups ignore difficult terrain, as now. |
| D6 | Special links | Shared borders connect automatically. The GM can add **extra links** (tunnels, sea lanes, secret passes), which can be hidden until discovered, and can **block** a shared border (a wall). |
| D7 | Existing data | Test data only. The migration still runs and reports what it couldn't convert. |
| D8 | "?" regions | Players see their outline, nothing else. |
| D9 | Gaps between shapes | Open ground: impassable. |
| D10 | Corners | Regions touching only at a corner are neighbours too. |
| D11 | Converted maps | Regions that touch but weren't connected before start with a **blocked** border, so movement (and sight: a blocked border counts as none) stays as it was until the GM unblocks them. |

## What stays the same

- Game rules, except movement measurement (D4–D6), which the brief allows for the region change.
- **Fog of war** stays exactly as in [VISIBILITY.md](../VISIBILITY.md): own regions, regions with units, Scout and Watchtower range, DM-granted vision, faded "seen before" regions, and "?" neighbours. "?" regions show their outline only, with no name or details.
- **Syncing:** pages still load fresh data from the server, and teammates' orders are still protected by version numbers. There is no live push.
- **Validation:** every order is still checked on the server against the team's view, then again against the real state when the DM resolves.
- Every current feature stays; it moves into the new layout.

## Phases

Each phase leaves the app working. I stop after each one with a summary and test steps.

### Phase 1: Theme and design system
- One set of design tokens in `globals.css` for colours, radii, spacing, shadows, blur and transition speed. Tailwind classes read from them.
- Dark by default: a deep blue background with a lighter gradient from the top. Light mode stays available. Rounded buttons, panels and inputs.
- A `.glass` panel style: light blur, about 90% opaque. Every text/background pair is checked for WCAG AA contrast.
- A `--team-color` variable, set from the team's colour on player screens. It's used for borders, highlights, active buttons, tokens and labels only.
- **Team emblems:** a set of simple SVG icons (shield, crown, tower, wolf and so on). The DM picks one per team in the Teams editor; this uses the existing, unused `emblem` field. Emblems appear on badges, tokens, the legend and the header.
- A shared UI kit (`Button`, `IconButton`, `Panel`, `Input`, `Select`, `Badge`, `Tabs`) with hover, press and focus states and quick transitions. Inline SVG icons, so no new dependency.
- Every existing page is restyled. No layout changes yet.

### Phase 2: Layout shell
- `/play` becomes one screen: the map fills it, with a toolbar on top showing the team, round, countdown and buttons.
- Overlays, chosen by purpose:
  - **Side panel:** region and unit info.
  - **Modal:** confirmations and short forms (rename unit, leave game).
  - **Movable, resizable windows:** Orders, Results, Units, Regions, Inventory and economy, Trades, Rules, Help.
- **One tool window at a time.** Each tool is still its own page (`/play/orders`…) shown in the window, so it always loads fresh data and refresh, back and shared links work. (Keeping several open at once would mean either showing out-of-date data in the background windows or rewriting how every screen loads its data.) `/play` is the bare map; `/play/map` redirects there; the old dashboard is the **Overview** window.
- Escape closes the top overlay; every overlay has a close button. Window positions are remembered per browser.
- The DM World map gets the same shell, with Resolve, Teams and Diplomacy as windows.
- Uses the current node map.

### Phase 3: Click-to-inspect
- Clicking a region or unit opens the side panel. It shows only what the server already sent, so fog of war is unchanged.
- From the panel: units in the region (yours in full, others only by type and owner), quick actions that start an order, and links into the relevant window.

### Phase 4: Nodes → regions (data and editor)
- **Schema:** regions get a `polygon`. A new `terrain_areas` table holds overlay polygons, each with a terrain type. Units get an exact `x`/`y`. Games get a map scale (miles per map width). `connections` becomes the table of **extra links** and **blocked borders**. Old node positions become each region's label point.
- **Geometry engine** (`src/engine/geo/`, pure code with tests): point-in-polygon, shared-edge detection (automatic adjacency), the length of a line inside a polygon, and which border a line crosses.
- **Movement engine:** a path is a list of waypoints. The cost walks each segment, adds terrain multipliers for the parts inside overlays, and records which regions it enters, in order. Crossing a border needs adjacency (or an extra link) and must not be blocked. Combat, stealth and fog keep using that region sequence. A unit stopped by monsters stops just inside the region it entered.
- **Fog image:** the server fogs by region shape instead of circles.
- **GM map editor:** upload the image, set the scale, draw and edit polygons with vertex snapping and shared-edge snapping, draw terrain overlays, name regions, and add or hide extra links and block borders. The region detail form stays as it is.
- **Migration** (`scripts/migrate-regions.ts`): turns each node into a starter polygon (a Voronoi cell clipped to the map) and puts units at their region's label point. Connections between regions that now touch are dropped; the rest become extra links. It reports anything it couldn't convert: hidden connections, connections between regions that don't touch, custom per-connection miles, and per-connection terrain (which has no overlay area until the GM draws one).

### Phase 5: Drag and drop with drawn paths (built)
- Drag one of your stacks (its badge) and drop it where it should go; press Shift on the way to add a bend. A live line shows the miles used out of the miles left; it turns red with the reason ("Can't cross here", "Too far") when the move can't happen.
- Dropping queues a Move order. When more than one kind of move fits (Move, Force March, Stealth…), a popup asks which, with the miles for each. If a move of the same kind is already going from the same region to the same region, the units join it instead of using another numbered action.
- An illegal drop (a blocked border, not enough movement left, no numbered actions left) queues nothing and says why.
- Queued moves are drawn on the map, numbered by their action, and units with queued moves show as a see-through stack where they'll end up; drag that to plan the next move from there. Click a route to see its checks and **Redraw on map**, **Open in orders** or **Cancel move**.
- Tap-to-move: **Move on map** in a unit's panel, then tap the stops; **Done** (or Enter) queues it, Undo (Backspace) removes the last stop, Cancel (Esc) stops. This is also how to move one unit out of a stack.
- The order list is shared between the map and the Orders window (`src/components/play/ordersDraft.tsx`), so changes in one show in the other. Changes made on the map save the draft straight away; submitted orders need submitting again, as before.
- Everything is a preview: the Orders window and the server check each order as before, and moves still resolve only when the DM resolves the round.
### Phase 6: Toggleable 3D map (built)
- **2D / 3D** switch in the corner of the player map and the DM's World map, remembered on each device. three.js (react-three-fiber and drei) is loaded only when 3D is turned on.
- The DM uploads a greyscale height map in the map editor (**3D & light**); it's stored as a PNG at most 1024 px across. Players get it from `/api/play/height`, flattened outside the regions they have seen (remembered regions keep their hills), like the fogged map image.
- The ground is a mesh raised by the height map. The map image and everything the 2D map draws over it (regions, terrain, borders, labels, planned routes) are drawn once as SVG (the same `MapLayers` component the 2D map uses) and painted onto it as a texture. Unit stacks stand on the ground as the same badges as in 2D; the move being planned is a line just above the ground.
- Camera: pan (drag, one finger), turn and tilt (right-drag, two fingers), zoom (wheel, pinch); it can't tilt to the horizon or leave the map. Fit and zoom buttons.
- Clicks and drags work as in 2D: the pointer's ray is followed to the ground (`three/heightField.ts`), then the region, badge or route there is used. Drag-to-move, tap-to-move, route clicks and the DM's panel drags all work in 3D.
- **Lighting** (DM, in the map editor, with a live preview): the sun is a point light with a colour, direction, height in the sky and brightness; sky light with a colour and strength; hills can cast shadows; **Darkness** dims every light for night and also lays a dark wash over the 2D map. Stored as `games.map_look`.
- 2D stays the default. 3D turns itself off if WebGL is missing, or if it draws fewer than 15 frames a second in its first few seconds; the player sees why and can try again.
- Not done: the separate `/dev/map3d` prototype page (built straight into the map instead), 3D in the Orders window's route picker (2D there).

### Phase 7: Phone and tablet view
- Small or touch screens use 2D only. A tap opens a bottom sheet; overlays become full-screen sheets with large touch targets.
- Tap-to-move: tap a unit, tap points to add bends, then tap **Done**.
- A "Simple view" switch lets desktop users use it too.

## Small calls (agreed)
- **Moving into the fog:** a path can go as far into the fog as the unit's movement allows, even through regions the team can't see or doesn't know. The browser shows the fogged part of the line as "unknown ground" and can only estimate its cost from what the team knows. The server works out the real regions and terrain, and checks the order fully when the DM resolves the round. If a move turns out impossible (for example, water with no swim speed), the unit stops at the last point it could reach and the DM sees why. Nothing about unseen regions is sent to the player while they plan.
- Dark is the default; light mode stays as an option.
- Icons are inline SVGs kept in one icon registry (`src/components/icons/`). It's built so that **unit icons** can be added later (bundled or DM-uploaded) without changing the components that draw them.
