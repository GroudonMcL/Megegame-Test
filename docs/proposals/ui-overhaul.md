# Proposal: UI overhaul

Status: **approved**. Phase 1 (theme) and Phase 2 (layout shell) are built.

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

### Phase 5: Drag and drop with drawn paths
- Drag a unit (or a whole stack) and drop it. Waypoints add bends: click on the way, or hold Shift while dragging. A live line shows miles used and miles left, coloured by terrain.
- An illegal drop is shown in red with the reason from the order checker ("needs a fly speed", "only 6 miles left"), and no order is created.
- On a valid drop the D3 popup appears, and the order appears in the Orders window. Planned paths are drawn on the map, and you can click one to edit or cancel it.
- Stacks show a count badge and fan out on hover or click so you can pick one unit.
- Moves still resolve only when the DM resolves the round.

### Phase 6: Toggleable 3D map
- First a standalone prototype page (`/dev/map3d`), then integration.
- **react-three-fiber** (Three.js for React). It's added only to the 3D page's code, so 2D users don't download it.
- The GM uploads a height map in the editor. The server fogs it like the map image, so hidden terrain shape never reaches players.
- The terrain is displaced by the height map, with the map image as its texture. Borders, routes and planned paths are draped on the surface, and tokens sit on it with labels above.
- Camera: pan, zoom and limited tilt and rotation, clamped to the map.
- Click-to-inspect and drag-to-move use raycasting and share the 2D logic.
- 2D stays the default. 3D turns itself off if WebGL is missing or the frame rate stays low, and remembers that.

### Phase 7: Phone and tablet view
- Small or touch screens use 2D only. A tap opens a bottom sheet; overlays become full-screen sheets with large touch targets.
- Tap-to-move: tap a unit, tap points to add bends, then tap **Done**.
- A "Simple view" switch lets desktop users use it too.

## Small calls (agreed)
- **Moving into the fog:** a path can go as far into the fog as the unit's movement allows, even through regions the team can't see or doesn't know. The browser shows the fogged part of the line as "unknown ground" and can only estimate its cost from what the team knows. The server works out the real regions and terrain, and checks the order fully when the DM resolves the round. If a move turns out impossible (for example, water with no swim speed), the unit stops at the last point it could reach and the DM sees why. Nothing about unseen regions is sent to the player while they plan.
- Dark is the default; light mode stays as an option.
- Icons are inline SVGs kept in one icon registry (`src/components/icons/`). It's built so that **unit icons** can be added later (bundled or DM-uploaded) without changing the components that draw them.
