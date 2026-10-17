import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { isDm } from "@/lib/session";
import { DmLoginForm } from "./DmLoginForm";

export default async function DmLoginPage() {
  if (await isDm()) redirect("/dm");
  return (
    <Page>
      <h1 className="text-2xl font-semibold">DM login</h1>
      <Card className="mt-6 max-w-sm">
        <DmLoginForm />
      </Card>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-accent underline">← Back</Link>
      </p>
    </Page>
  );
}
