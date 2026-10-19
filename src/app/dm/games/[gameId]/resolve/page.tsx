import { ResolveClient, type ResolveItem } from "@/components/resolve/ResolveClient";
import { describeChange, describeInputs } from "@/engine/resolve/describe";
import { lastAuditEntry, loadQueue, type EndOfRoundState } from "@/lib/resolution";
import { requireDm } from "@/lib/session";

export default async function ResolvePage({ params }: PageProps<"/dm/games/[gameId]/resolve">) {
  await requireDm();
  const { gameId } = await params;
  const { round, steps, ruleset, world } = await loadQueue(gameId);
  const last = round ? await lastAuditEntry(gameId, round.id) : null;
  const actionName = (id: string) => ruleset.actionTypes.find((a) => a.id === id)?.name ?? id;
  const regionName = (id: string | null) => {
    const reg = world.regions.find((x) => x.id === id);
    return reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "?";
  };

  const data = steps.map((s) => ({
    step: s.step,
    pending: s.pending,
    flags: s.flags.map((f) => ({ kind: f.kind, text: f.text, orderIds: f.orderIds })),
    items: s.items.map(
      (i): ResolveItem => ({
        id: i.order.id,
        teamId: i.order.teamId,
        teamName: i.teamName,
        teamColour: i.teamColour,
        kind: i.order.kind,
        slot: i.order.slot,
        status: i.order.status,
        submitted: i.submitted,
        backup: i.backup,
        scene: i.scene,
        actionName: actionName(i.order.actionTypeId),
        inputs: describeInputs(ruleset, world, { id: i.order.id, kind: i.order.kind as "numbered", actionTypeId: i.order.actionTypeId, inputs: i.order.inputs, notes: "" }),
        notes: i.order.notes,
        outcome: i.outcome
          ? {
              text: i.outcome.text ?? "",
              adjust: i.outcome.adjust ?? {},
              hideRolls: i.outcome.hideRolls ?? false,
              delta: i.outcome.delta ?? null,
              proposal: i.outcome.proposal
                ? {
                    status: i.outcome.proposal.status,
                    problems: i.outcome.proposal.problems,
                    notes: i.outcome.proposal.notes,
                    rolls: i.outcome.proposal.rolls.map((r) => ({ label: r.label, breakdown: r.breakdown })),
                    changes: i.outcome.proposal.changes.map((c) => describeChange(ruleset, world, c)),
                    fights: (i.outcome.proposal.combats ?? []).map((f) => ({
                      regionName: regionName(f.regionId),
                      sides: f.sides.map(({ id, name }) => ({ id, name })),
                      winner: f.winner,
                      endReason: f.endReason,
                      rounds: f.rounds,
                      units: f.units.map((u) => ({ unitId: u.unitId, sideId: u.sideId, label: u.label, startHp: u.startHp, hp: u.hp, maxHp: u.maxHp, outcome: u.outcome, raised: Boolean(u.raised) })),
                      warnings: f.warnings,
                      log: f.log,
                    })),
                  }
                : null,
              fightSettings: {
                priority: i.outcome.combat?.priority ?? {},
                byHand: Boolean(i.outcome.combat?.byHand),
                shareLog: i.outcome.combat?.shareLog !== false,
                overrides: i.outcome.combat?.overrides ?? {},
              },
              odds: i.outcome.odds ?? null,
            }
          : null,
      }),
    ),
  }));

  const eor = round?.endOfRound as EndOfRoundState | null;
  const teamName = (id: string) => world.teams.find((t) => t.id === id)?.name ?? "?";
  return (
    <ResolveClient
      gameId={gameId}
      round={round ? { number: round.number, status: round.status } : null}
      steps={data}
      resources={ruleset.resources}
      lastUndo={last?.description ?? null}
      endOfRound={
        eor
          ? {
              applied: eor.applied,
              adjust: eor.adjust,
              teams: eor.result.teams.map((t) => ({
                teamId: t.teamId,
                teamName: teamName(t.teamId),
                economy: t.economy,
                rolls: t.rolls.map((r) => ({ label: r.label, breakdown: r.breakdown })),
                lines: t.lines,
                notes: t.notes,
              })),
              wild: eor.result.wild.lines,
              events: eor.events ?? null,
              eventTables: ruleset.rollTables.filter((t) => t.category === "event").map((t) => ({ id: t.id, name: t.name })),
              trades: (eor.result.trades ?? []).map((t) => ({ summary: t.summary, ok: t.ok, problems: t.problems })),
            }
          : null
      }
    />
  );
}
