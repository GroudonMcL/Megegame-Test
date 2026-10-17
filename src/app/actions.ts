"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { normaliseJoinCode } from "@/lib/joinCode";
import { clearSession, setSession } from "@/lib/session";

export type FormState = { error?: string; values?: Record<string, string> } | undefined;

const JoinInput = z.object({
  code: z.string().min(1, "Enter your team's join code."),
  name: z.string().trim().min(1, "Enter a display name.").max(40, "Keep your name under 40 characters."),
});

export async function joinTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { code: String(formData.get("code") ?? ""), name: String(formData.get("name") ?? "") };
  const parsed = JoinInput.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const code = normaliseJoinCode(parsed.data.code);
  const team = code
    ? (await db.select().from(schema.teams).where(eq(schema.teams.joinCode, code)).limit(1))[0]
    : undefined;
  if (!team) {
    // Slow down anyone trying to guess codes.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "That join code didn't match any team. Check it with your DM.", values };
  }

  const [player] = await db
    .insert(schema.players)
    .values({ teamId: team.id, displayName: parsed.data.name })
    .returning();
  await setSession({ role: "team", teamId: team.id, gameId: team.gameId, playerId: player.id, epoch: team.sessionEpoch });
  redirect("/play");
}

export async function logout() {
  await clearSession();
  redirect("/");
}
