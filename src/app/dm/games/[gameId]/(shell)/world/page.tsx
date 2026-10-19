import { requireDm } from "@/lib/session";

// The bare World map: the (shell) layout draws it; no window is open.
export default async function WorldPage() {
  await requireDm();
  return null;
}
