"use client";

import { useActionState } from "react";
import { joinTeam } from "./actions";
import { Button, FormError, Input, Label } from "@/components/ui";

export function JoinForm() {
  const [state, action, pending] = useActionState(joinTeam, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="code">Join code</Label>
        <Input id="code" name="code" placeholder="ABCD-EFGH-JKMN" autoComplete="off" autoCapitalize="characters" defaultValue={state?.values?.code} required />
      </div>
      <div>
        <Label htmlFor="name">Your display name</Label>
        <Input id="name" name="name" placeholder="e.g. Finlay" maxLength={40} defaultValue={state?.values?.name} required />
      </div>
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Joining…" : "Join team"}
      </Button>
    </form>
  );
}
