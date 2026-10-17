"use client";

import { useActionState } from "react";
import { dmLogin } from "../actions";
import { Button, FormError, Input, Label } from "@/components/ui";

export function DmLoginForm() {
  const [state, action, pending] = useActionState(dmLogin, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="password">DM password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Log in"}
      </Button>
    </form>
  );
}
