"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { checkDmPassword } from "@/lib/dmPassword";
import { generateJoinCode } from "@/lib/joinCode";
import { requireDm, setSession } from "@/lib/session";
import type { FormState } from "../actions";

export async function dmLogin(_prev: FormState, formData: FormData): Promise<FormState> {
  const attempt = String(formData.get("password") ?? "");
  if (!process.env.DM_PASSWORD) return { error: "No DM password has been set up yet (DM_PASSWORD). See docs/SETUP.md." };
  if (!checkDmPassword(attempt, process.env.DM_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800));
    return { error: "Wrong password." };
  }
  await setSession({ role: "dm" });
  redirect("/dm");
}

const GameInput = z.object({ name: z.string().trim().min(1, "Give the game a name.").max(80) });

export async function createGame(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireDm();
  const parsed = GameInput.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(schema.games).values({ name: parsed.data.name });
  revalidatePath("/dm");
  return undefined;
}

const TeamInput = z.object({
  gameId: z.uuid(),
  name: z.string().trim().min(1, "Give the team a name.").max(60),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour."),
});

export async function createTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireDm();
  const parsed = TeamInput.safeParse({
    gameId: formData.get("gameId"),
    name: formData.get("name"),
    colour: formData.get("colour"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(schema.teams).values({ ...parsed.data, joinCode: generateJoinCode() });
  revalidatePath("/dm");
  return undefined;
}

/** New code for a team. Everyone currently signed in to that team is signed out. */
export async function regenerateJoinCode(formData: FormData) {
  await requireDm();
  const teamId = z.uuid().parse(formData.get("teamId"));
  await db
    .update(schema.teams)
    .set({ joinCode: generateJoinCode(), sessionEpoch: sql`${schema.teams.sessionEpoch} + 1` })
    .where(eq(schema.teams.id, teamId));
  revalidatePath("/dm");
}
