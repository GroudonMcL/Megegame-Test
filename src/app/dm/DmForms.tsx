"use client";

import { useActionState, useRef } from "react";
import { createGame, createTeam } from "./actions";
import { Button, FormError, Input, Label } from "@/components/ui";

export function CreateGameForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof createGame>[0], fd: FormData) => {
    const result = await createGame(prev, fd);
    if (!result?.error) formRef.current?.reset();
    return result;
  }, undefined);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="game-name">New game name</Label>
        <Input id="game-name" name="name" placeholder="e.g. Test Game" required />
      </div>
      <Button type="submit" disabled={pending}>Create game</Button>
      <FormError message={state?.error} />
    </form>
  );
}

export function CreateTeamForm({ gameId }: { gameId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof createTeam>[0], fd: FormData) => {
    const result = await createTeam(prev, fd);
    if (!result?.error) formRef.current?.reset();
    return result;
  }, undefined);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="gameId" value={gameId} />
      <div className="flex-1">
        <Label htmlFor={`team-name-${gameId}`}>New team name</Label>
        <Input id={`team-name-${gameId}`} name="name" placeholder="e.g. Test Team" required />
      </div>
      <div>
        <Label htmlFor={`team-colour-${gameId}`}>Colour</Label>
        <input
          id={`team-colour-${gameId}`}
          name="colour"
          type="color"
          defaultValue="#4f46e5"
          className="h-10 w-16 rounded-lg border border-border bg-background"
        />
      </div>
      <Button type="submit" disabled={pending}>Add team</Button>
      <FormError message={state?.error} />
    </form>
  );
}
