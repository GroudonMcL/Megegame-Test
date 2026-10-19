import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Two kinds of data live here (see docs/DATA-MODEL.md):
//  - rules content: one JSON ruleset per game (game_rulesets), validated by
//    src/engine/ruleset. Instances refer to its definitions by string ID.
//  - game state: teams, regions, units, rounds, orders and logs, in tables.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

import type { TradeBundle } from "../engine/trades";

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("setup"),
  presetId: text("preset_id").notNull().default("blank"),
  currentRound: integer("current_round").notNull().default(0),
  // The map background image (an asset), if one has been uploaded.
  mapAssetId: uuid("map_asset_id"),
  // The public channel's Discord webhook (round opened, reminders, published). Secret: DM only.
  discordWebhookUrl: text("discord_webhook_url").notNull().default(""),
  createdAt: created(),
});

/** Uploaded files (map images, emblems), served only through the app's own routes. */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    data: bytea("data").notNull(),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size").notNull(),
    createdAt: created(),
  },
  (t) => [index("assets_game_idx").on(t.gameId)],
);

export const gameRulesets = pgTable("game_rulesets", {
  gameId: uuid("game_id")
    .primaryKey()
    .references(() => games.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull(),
  // Bumped on every save; a save based on an older version is refused.
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    colour: text("colour").notNull().default("#6366f1"),
    // NPC factions (e.g. a giant tribe) are teams the DM controls; they get no join code use.
    isNpc: boolean("is_npc").notNull().default(false),
    emblem: text("emblem").notNull().default(""),
    joinCode: text("join_code").notNull().unique(),
    // Bumped whenever the join code is regenerated. Sessions carry the epoch
    // they were issued under, so regenerating a code logs everyone out.
    sessionEpoch: integer("session_epoch").notNull().default(0),
    baseRaceId: text("base_race_id"),
    raceIds: jsonb("race_ids").$type<string[]>().notNull().default([]),
    resources: jsonb("resources").$type<Record<string, number>>().notNull().default({}),
    knownRecipeIds: jsonb("known_recipe_ids").$type<string[]>().notNull().default([]),
    // Monster types this team has seen; their stat blocks show in its rules reference.
    seenCreatureIds: jsonb("seen_creature_ids").$type<string[]>().notNull().default([]),
    secretObjectives: text("secret_objectives").notNull().default(""),
    notes: text("notes").notNull().default(""),
    discordWebhookUrl: text("discord_webhook_url").notNull().default(""),
    createdAt: created(),
  },
  (t) => [index("teams_game_idx").on(t.gameId)],
);

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("players_team_idx").on(t.teamId)],
);

/** A ruin or dungeon inside a region. */
export interface Structure {
  kind: "ruin" | "dungeon";
  name: string;
  description: string;
  searched: boolean;
  hidden: boolean;
}
/** A resource deposit; hidden ones are only shown once discovered. */
export interface Deposit {
  id: string;
  name: string;
  note: string;
  hidden: boolean;
  /** Per-round income once claimed (Utterdark: mined raw resources produce 2). */
  production?: Record<string, number>;
}
/** A building standing in a region's slot. */
export interface PlacedBuilding {
  buildingId: string;
  tier: number;
  /** e.g. the Academy's chosen ability. */
  choice?: string;
}

export const regions = pgTable(
  "regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    // Position on the map image, as fractions of its width and height (0–1).
    x: real("x").notNull(),
    y: real("y").notNull(),
    settleable: boolean("settleable").notNull().default(true),
    hidden: boolean("hidden").notNull().default(false),
    ownerTeamId: uuid("owner_team_id").references(() => teams.id, { onDelete: "set null" }),
    settlementTierId: text("settlement_tier_id"),
    buildings: jsonb("buildings").$type<PlacedBuilding[]>().notNull().default([]),
    structures: jsonb("structures").$type<Structure[]>().notNull().default([]),
    deposits: jsonb("deposits").$type<Deposit[]>().notNull().default([]),
    // Effects (from the ruleset's effect system) that this region applies, e.g. a lava hazard.
    features: jsonb("features").$type<unknown[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdAt: created(),
  },
  (t) => [index("regions_game_idx").on(t.gameId), uniqueIndex("regions_game_code_idx").on(t.gameId, t.code)],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    regionA: uuid("region_a")
      .notNull()
      .references(() => regions.id, { onDelete: "cascade" }),
    regionB: uuid("region_b")
      .notNull()
      .references(() => regions.id, { onDelete: "cascade" }),
    // Null = the ruleset's default connection length.
    miles: real("miles"),
    terrainId: text("terrain_id").notNull().default("normal"),
    hidden: boolean("hidden").notNull().default(false),
  },
  // region_a is always the smaller ID, so each pair can only be connected once.
  (t) => [index("connections_game_idx").on(t.gameId), uniqueIndex("connections_pair_idx").on(t.regionA, t.regionB)],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    // Null = wild monster.
    ownerTeamId: uuid("owner_team_id").references(() => teams.id, { onDelete: "set null" }),
    creatureId: text("creature_id").notNull(),
    name: text("name").notNull().default(""),
    raceId: text("race_id"),
    archetypeId: text("archetype_id"),
    // e.g. { "str": 2 } from an Academy.
    academyBonus: jsonb("academy_bonus").$type<Record<string, number>>().notNull().default({}),
    augmentIds: jsonb("augment_ids").$type<string[]>().notNull().default([]),
    hp: integer("hp").notNull(),
    regionId: uuid("region_id").references(() => regions.id, { onDelete: "set null" }),
    milesUsed: real("miles_used").notNull().default(0),
    // active | hidden | dead | captured | tamed | stored | disbanded
    status: text("status").notNull().default("active"),
    // A leader pays no upkeep (Utterdark's starting hero).
    isLeader: boolean("is_leader").notNull().default(false),
    // Per-round ability uses spent, e.g. { "Fireball": 1 }.
    usesSpent: jsonb("uses_spent").$type<Record<string, number>>().notNull().default({}),
    // Corpse: how much is left to harvest.
    harvestLeft: jsonb("harvest_left").$type<{ itemId: string; qty: number }[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdAt: created(),
  },
  (t) => [index("units_game_idx").on(t.gameId), index("units_region_idx").on(t.regionId)],
);

export const inventory = pgTable(
  "inventory",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    qty: integer("qty").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.itemId] })],
);

/** What each team has discovered or been granted on the map. */
export const teamRegionKnowledge = pgTable(
  "team_region_knowledge",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "cascade" }),
    discovered: boolean("discovered").notNull().default(true),
    searched: boolean("searched").notNull().default(false),
    // Granted by the DM (spying, trading map info): always visible.
    permanentVision: boolean("permanent_vision").notNull().default(false),
    // Snapshot of what the team last saw, for "previously seen" display.
    lastSeen: jsonb("last_seen"),
    lastSeenRound: integer("last_seen_round"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.regionId] })],
);

export const teamConnectionKnowledge = pgTable(
  "team_connection_knowledge",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.connectionId] })],
);

/** Hidden units a team has detected. */
export const teamUnitDetections = pgTable(
  "team_unit_detections",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.unitId] })],
);

/** Teams that have met, and so may trade. Stored once per pair (teamA < teamB). */
export const teamContacts = pgTable(
  "team_contacts",
  {
    teamA: uuid("team_a")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    teamB: uuid("team_b")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    since: integer("since_round").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.teamA, t.teamB] })],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    // draft | open | locked | resolving | review | published
    status: text("status").notNull().default("draft"),
    deadline: timestamp("deadline", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // When the "deadline in 24 hours" reminder went to Discord.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Full game state at publish time, for history and rollback.
    snapshot: jsonb("snapshot"),
    // Game state when resolution started; players see this until the round is published.
    startSnapshot: jsonb("start_snapshot"),
    // The end-of-round phase: computed per-team economy, rolls and the DM's adjustments.
    endOfRound: jsonb("end_of_round"),
  },
  (t) => [uniqueIndex("rounds_game_number_idx").on(t.gameId, t.number)],
);

/**
 * A trade between two teams that have met. The proposer offers `give` for
 * `get`; the other team accepts or declines. Accepted trades execute at the end
 * of the round, if both sides can still pay.
 */
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    fromTeamId: uuid("from_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    toTeamId: uuid("to_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // The round it was proposed in.
    round: integer("round").notNull(),
    give: jsonb("give").$type<TradeBundle>().notNull(),
    get: jsonb("get").$type<TradeBundle>().notNull(),
    message: text("message").notNull().default(""),
    // proposed | accepted | declined | cancelled | executed | failed
    status: text("status").notNull().default("proposed"),
    // Why it failed, or a summary once executed.
    result: text("result").notNull().default(""),
    executedRound: integer("executed_round"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("trades_game_idx").on(t.gameId)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // Position in the team's list (0-based); free and conditional orders sit between numbered ones.
    position: integer("position").notNull(),
    // numbered | free | conditional
    kind: text("kind").notNull(),
    // Numbered slot (1..N) for numbered orders; null otherwise.
    slot: integer("slot"),
    // For conditional orders: the order whose failure triggers it.
    parentOrderId: uuid("parent_order_id"),
    actionTypeId: text("action_type_id").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes").notNull().default(""),
    // draft | submitted | ready | needsReview | needsDm | resolved | failed | skipped
    status: text("status").notNull().default("draft"),
    outcome: jsonb("outcome"),
    // Set when the DM bypassed validation for this order.
    bypassed: boolean("bypassed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_round_team_idx").on(t.roundId, t.teamId)],
);

/** A team's order list for one round: who submitted it, and a version that stops teammates overwriting each other. */
export const teamRoundOrders = pgTable(
  "team_round_orders",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // Bumped on every save.
    version: integer("version").notNull().default(0),
    // Null = still a draft.
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: text("submitted_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.teamId] })],
);

export const rollLog = pgTable(
  "roll_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => rounds.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    expression: text("expression").notNull(),
    seed: text("seed").notNull(),
    // Dice breakdown, modifiers and table band.
    result: jsonb("result").notNull(),
    total: integer("total").notNull(),
    tableId: text("table_id"),
    overridden: boolean("overridden").notNull().default(false),
    hiddenFromPlayers: boolean("hidden_from_players").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("roll_log_game_idx").on(t.gameId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => rounds.id, { onDelete: "set null" }),
    // "dm", "engine" or "team:<id>"
    actor: text("actor").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    // Enough to undo: the affected rows before and after.
    before: jsonb("before"),
    after: jsonb("after"),
    undone: boolean("undone").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("audit_log_game_idx").on(t.gameId)],
);
