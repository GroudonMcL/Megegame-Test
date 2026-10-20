"use client";

import { useId, useState, type ReactNode } from "react";
import { MAX_MESSAGE_LENGTH, type TeamNote } from "@/engine/messages";

// "Send a note to the team": an optional tick box with an editable message,
// for any change the DM makes for a team. The message follows the suggested
// text (which can change as the DM edits) until the DM types their own.
// The note travels with the change's server action, which hands it to
// sendDmNote (src/lib/messages.ts); it arrives in the team's Messages.

export interface TeamNoteState {
  send: boolean;
  /** null = use the suggested text. */
  text: string | null;
}

export const NO_NOTE: TeamNoteState = { send: false, text: null };

/** The note to send with a change, from the option's state and the current suggestion. */
export function noteFor(state: TeamNoteState, suggested: string): TeamNote {
  return { send: state.send, text: state.text ?? suggested };
}

/** The tick box and message, controlled by the caller. */
export function TeamNoteOption({ suggested, value, onChange, teamName }: { suggested: string; value: TeamNoteState; onChange: (v: TeamNoteState) => void; teamName?: string }) {
  const id = useId();
  const text = value.text ?? suggested;
  return (
    <div className="space-y-1 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.send} onChange={(e) => onChange({ ...value, send: e.target.checked })} />
        Send a note to {teamName ? teamName : "the team"}
      </label>
      {value.send && (
        <>
          <label htmlFor={id} className="sr-only">
            Note to the team
          </label>
          <textarea
            id={id}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none hover:border-border-strong focus:border-accent"
            value={text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
          <p className="text-xs text-muted">
            Arrives in the team&apos;s Messages from the DM.
            {value.text !== null && value.text !== suggested && (
              <>
                {" "}
                <button type="button" className="text-link underline" onClick={() => onChange({ ...value, text: null })}>
                  Use the suggested text
                </button>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The usual way to use it: const note = useTeamNote(suggested), put note.ui in
 * the form, pass note.value to the action, and call note.reset() once it worked.
 */
export function useTeamNote(suggested: string, teamName?: string): { value: TeamNote; ui: ReactNode; reset: () => void } {
  const [state, setState] = useState<TeamNoteState>(NO_NOTE);
  return {
    value: noteFor(state, suggested),
    ui: <TeamNoteOption suggested={suggested} value={state} onChange={setState} teamName={teamName} />,
    reset: () => setState(NO_NOTE),
  };
}
