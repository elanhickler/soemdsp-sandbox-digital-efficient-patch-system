// Phase 6 round 3: the actual network hop. A minimal HTTP polling relay
// (server.py's /api/multiplayer/broadcast and /api/multiplayer/poll) --
// not websockets, on purpose: it's the smallest thing that proves two
// independent browser sessions can exchange LWW field edits and converge,
// without adding a new dependency to a project whose README promises
// "no package install needed". Real-time-ness is bounded by poll interval;
// this is a proof of the pipeline, not a production transport.
//
// Deliberately NOT wired to the live editor's UI event listeners yet (no
// slider/drag handler calls into this). That's still a separate round --
// this proves the transport itself works, the same way round 1 proved the
// merge math before round 2 proved it could be applied live.

async function nodeGraphLwwBroadcastFieldEdit(sessionId, message) {
  const response = await fetch("/api/multiplayer/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  return response.json();
}

async function nodeGraphLwwPollRemoteMessages(sessionId, since = 0) {
  const url = `/api/multiplayer/poll?sessionId=${encodeURIComponent(sessionId)}&since=${encodeURIComponent(since)}`;
  const response = await fetch(url);
  return response.json();
}

// Convenience wrapper: broadcasts one LWW field edit (the same shape
// nodeGraphLwwApplyFieldEdit's caller already has) as a poll-able message.
async function nodeGraphLwwBroadcastEdit(sessionId, nodeId, path, value, updatedAt, siteId) {
  return nodeGraphLwwBroadcastFieldEdit(sessionId, {
    kind: "field",
    nodeId,
    path,
    value,
    updatedAt,
    siteId,
  });
}

async function nodeGraphLwwBroadcastDelete(sessionId, nodeId, updatedAt, siteId) {
  return nodeGraphLwwBroadcastFieldEdit(sessionId, {
    kind: "delete",
    nodeId,
    updatedAt,
    siteId,
  });
}

// Applies a batch of remote messages (as returned by
// nodeGraphLwwPollRemoteMessages) onto a local LWW doc, returning the new
// doc. Pure function -- does not touch the live patch; pair with
// nodeGraphLwwApplyMergedDocToLivePatch (node-graph-patch-lww-live.js) to
// actually reflect the result in the running editor.
function nodeGraphLwwApplyRemoteMessages(doc, messages) {
  let next = doc;
  for (const message of messages) {
    if (message.kind === "field") {
      next = nodeGraphLwwApplyFieldEdit(next, message.nodeId, message.path, message.value, message.updatedAt, message.siteId);
    } else if (message.kind === "delete") {
      next = nodeGraphLwwApplyNodeDelete(next, message.nodeId, message.updatedAt, message.siteId);
    }
  }
  return next;
}
