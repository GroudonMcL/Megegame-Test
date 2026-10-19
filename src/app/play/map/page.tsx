import { redirect } from "next/navigation";

// The map is now always on screen behind every player window.
export default function OldMapPage() {
  redirect("/play");
}
