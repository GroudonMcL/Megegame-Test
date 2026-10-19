import { timingSafeEqual } from "node:crypto";
import { appOrigin, sendDueReminders } from "@/lib/discord";

// Called by Vercel Cron (vercel.json) once a day: posts a Discord reminder for
// every round whose deadline is less than 24 hours away. Vercel sends the
// CRON_SECRET environment variable as a bearer token.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET isn't set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Not allowed", { status: 401 });
  const sent = await sendDueReminders(await appOrigin());
  return Response.json({ sent });
}
