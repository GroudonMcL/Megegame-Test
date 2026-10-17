import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

// Phase 1 keeps only what login needs. The full data model (ruleset
// definitions vs. game-state instances) arrives in Phase 2.

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("setup"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    joinCode: text("join_code").notNull().unique(),
    // Bumped whenever the join code is regenerated. Sessions carry the epoch
    // they were issued under, so regenerating a code logs everyone out.
    sessionEpoch: integer("session_epoch").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
