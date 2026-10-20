import { Card } from "@/components/ui";
import { MessageThread } from "@/components/messages/MessageThread";
import { loadThread, markRead, threadUnread } from "@/lib/messages";
import { requireViewer } from "@/lib/viewer";
import { sendMessageAction } from "../actions";

// The team's conversation with the DM. The DM viewing as the team sees the
// same thread and writes as the DM; that doesn't mark it read for the team.

export default async function MessagesPage() {
  const viewer = await requireViewer();
  const reader = viewer.isDm ? "dm" : "team";
  const unread = await threadUnread(viewer.team, reader);
  if (unread) await markRead(viewer.gameId, viewer.teamId, reader);
  const messages = await loadThread(viewer.gameId, viewer.teamId);
  return (
    <Card>
      <h2 className="text-lg font-medium">{viewer.isDm ? `Messages with ${viewer.team.name}` : "Messages with the DM"}</h2>
      <p className="mt-1 mb-3 text-sm text-muted">
        {viewer.isDm
          ? "You're writing as the DM. Everyone on the team sees this conversation."
          : "Only your team and the DM see this conversation. Notes about changes the DM made for your team arrive here too."}
      </p>
      <MessageThread
        messages={messages}
        me={reader}
        send={sendMessageAction}
        hadUnread={unread > 0}
        empty={viewer.isDm ? "No messages with this team yet." : "No messages yet. Write to the DM below."}
      />
    </Card>
  );
}
