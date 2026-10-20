import Link from "next/link";
import { Card } from "@/components/ui";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import { MessageThread } from "@/components/messages/MessageThread";
import { dmInbox, loadThread, markRead } from "@/lib/messages";
import { dmSendMessageAction } from "./actions";

// The DM's messages: every team with its unread count, and the conversation
// with the chosen team. Players reply from their own Messages window.

export default async function DmMessagesPage({ params, searchParams }: PageProps<"/dm/games/[gameId]/messages">) {
  const { gameId } = await params;
  const sp = await searchParams;
  const inbox = await dmInbox(gameId);
  const chosen = inbox.find((e) => e.team.id === sp.team) ?? null;
  if (chosen?.unread) await markRead(gameId, chosen.team.id, "dm");
  const messages = chosen ? await loadThread(gameId, chosen.team.id) : [];
  const base = `/dm/games/${gameId}/messages`;

  return (
    <div className="grid gap-4 @2xl:grid-cols-[16rem_1fr] [&>*]:min-w-0">
      <Card className="p-3!">
        <h2 className="px-2 font-medium">Teams</h2>
        {inbox.length === 0 && <p className="mt-2 px-2 text-sm text-muted">No teams yet.</p>}
        <ul className="mt-2 space-y-1">
          {inbox.map((e) => (
            <li key={e.team.id}>
              <Link
                href={`${base}?team=${e.team.id}`}
                aria-current={e === chosen ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${e === chosen ? "bg-accent/15" : "hover:bg-raised"}`}
              >
                <TeamEmblem team={e.team} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.team.name}</span>
                  <span className="block truncate text-xs text-muted">{e.last ? `${e.last.authorName}: ${e.last.body}` : "No messages"}</span>
                </span>
                {e.unread > 0 && e !== chosen && (
                  <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-foreground tabular-nums">
                    {e.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        {chosen ? (
          <>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <TeamEmblem team={chosen.team} size={22} /> {chosen.team.name}
            </h2>
            <MessageThread
              key={chosen.team.id}
              messages={messages}
              me="dm"
              send={dmSendMessageAction.bind(null, gameId, chosen.team.id)}
              hadUnread={chosen.unread > 0}
              empty="No messages with this team yet."
            />
          </>
        ) : (
          <p className="text-sm text-muted">Pick a team to read and write to it. Notes you send with changes made while editing as a team show here too.</p>
        )}
      </Card>
    </div>
  );
}
