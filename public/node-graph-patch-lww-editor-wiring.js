// Phase 6 round 4: the editor wiring that was explicitly left "not built"
// in rounds 1-3. Everything underneath this file (merge engine, live-apply,
// transport) was proven independently first; this file only connects real
// UI events to it. Opt-in and off by default -- nodeGraphLwwMultiplayer.active
// starts false, so nothing here changes behavior for anyone not using
// multiplayer. No join/room UI is built; sessions are joined by calling
// startNodeGraphLwwMultiplayerSession(sessionId) directly (e.g. from a
// console, or a future UI control -- that control itself is still "not
// built", same as before).

const nodeGraphLwwMultiplayer = {
  active: false,
  sessionId: null,
  siteId: null,
  doc: null,
  since: 0,
  pollTimer: 0,
  pollIntervalMs: 500,
};

function nodeGraphLwwSiteId() {
  if (!nodeGraphLwwMultiplayer.siteId) {
    nodeGraphLwwMultiplayer.siteId = `site-${Math.random().toString(36).slice(2, 10)}`;
  }
  return nodeGraphLwwMultiplayer.siteId;
}

async function nodeGraphLwwPollOnce() {
  const { sessionId, since } = nodeGraphLwwMultiplayer;
  if (!sessionId) {
    return;
  }
  let result;
  try {
    result = await nodeGraphLwwPollRemoteMessages(sessionId, since);
  } catch (error) {
    return; // transient network failure -- next poll tick will retry with the same `since`
  }
  if (!result?.ok || !Array.isArray(result.messages) || result.messages.length === 0) {
    return;
  }
  // Drop any message this site broadcast itself -- broadcasts already apply
  // locally at the moment they're made (see nodeGraphLwwNotifyLocalFieldEdit),
  // so re-applying our own echoed-back message would just be redundant work,
  // not a correctness issue (LWW is idempotent), but there's no reason to pay
  // an extra commitNodeGraphPatch for it.
  const remoteOnly = result.messages.filter((message) => message.siteId !== nodeGraphLwwSiteId());
  nodeGraphLwwMultiplayer.since = result.nextSince;
  if (remoteOnly.length === 0) {
    return;
  }
  nodeGraphLwwMultiplayer.doc = nodeGraphLwwApplyRemoteMessages(nodeGraphLwwMultiplayer.doc, remoteOnly);
  nodeGraphLwwApplyMergedDocToLivePatch(nodeGraphLwwMultiplayer.doc, { record: false });
}

function startNodeGraphLwwMultiplayerSession(sessionId, basePatch = nodeGraphMvp.patch) {
  stopNodeGraphLwwMultiplayerSession();
  nodeGraphLwwMultiplayer.active = true;
  nodeGraphLwwMultiplayer.sessionId = sessionId;
  nodeGraphLwwMultiplayer.since = 0;
  nodeGraphLwwMultiplayer.doc = nodeGraphLwwDocFromNodesRecord(
    JSON.parse(serializeNodeGraphPatch(basePatch)).nodes,
    Date.now(),
    nodeGraphLwwSiteId(),
  );
  nodeGraphLwwMultiplayer.pollTimer = window.setInterval(nodeGraphLwwPollOnce, nodeGraphLwwMultiplayer.pollIntervalMs);
}

function stopNodeGraphLwwMultiplayerSession() {
  if (nodeGraphLwwMultiplayer.pollTimer) {
    window.clearInterval(nodeGraphLwwMultiplayer.pollTimer);
  }
  if (nodeGraphLwwBroadcastRafHandle) {
    window.cancelAnimationFrame(nodeGraphLwwBroadcastRafHandle);
    nodeGraphLwwBroadcastRafHandle = 0;
  }
  nodeGraphLwwPendingBroadcastEdits.clear();
  nodeGraphLwwMultiplayer.active = false;
  nodeGraphLwwMultiplayer.sessionId = null;
  nodeGraphLwwMultiplayer.doc = null;
  nodeGraphLwwMultiplayer.since = 0;
  nodeGraphLwwMultiplayer.pollTimer = 0;
}

// A native range slider's "input" event can fire far more than once per
// visible frame while dragging -- broadcasting on every single one would
// mean a network POST per pixel of mouse movement, not per meaningful
// update. Same reasoning and same fix as Phase 4 round 4's pan-drag
// throttle: coalesce to at most one broadcast per animation frame per
// field, using the latest value. A user's hand can't produce updates faster
// than the screen can show them, so anything beyond one-per-frame is
// network traffic nobody asked for.
const nodeGraphLwwPendingBroadcastEdits = new Map(); // fieldKey -> { nodeId, path, value }
let nodeGraphLwwBroadcastRafHandle = 0;

function nodeGraphLwwFlushPendingBroadcasts() {
  if (nodeGraphLwwBroadcastRafHandle) {
    window.cancelAnimationFrame(nodeGraphLwwBroadcastRafHandle);
    nodeGraphLwwBroadcastRafHandle = 0;
  }
  if (!nodeGraphLwwMultiplayer.active || !nodeGraphLwwMultiplayer.doc) {
    nodeGraphLwwPendingBroadcastEdits.clear();
    return;
  }
  const updatedAt = Date.now();
  const siteId = nodeGraphLwwSiteId();
  for (const { nodeId, path, value } of nodeGraphLwwPendingBroadcastEdits.values()) {
    nodeGraphLwwMultiplayer.doc = nodeGraphLwwApplyFieldEdit(nodeGraphLwwMultiplayer.doc, nodeId, path, value, updatedAt, siteId);
    nodeGraphLwwBroadcastEdit(nodeGraphLwwMultiplayer.sessionId, nodeId, path, value, updatedAt, siteId).catch(() => {});
  }
  nodeGraphLwwPendingBroadcastEdits.clear();
}

// Called from syncNodeGraphPatchParameterFromSlider (node-graph-slider-dragging.js)
// after it writes a param value locally, on every raw "input" event. Queues
// the latest value for this field and schedules at most one flush per
// animation frame -- fire-and-forget, since a dropped broadcast just means
// this field catches up on the next successful one (LWW is idempotent).
function nodeGraphLwwNotifyLocalFieldEdit(nodeId, path, value) {
  if (!nodeGraphLwwMultiplayer.active || !nodeGraphLwwMultiplayer.doc) {
    return;
  }
  nodeGraphLwwPendingBroadcastEdits.set(nodeGraphLwwFieldKey(nodeId, path), { nodeId, path, value });
  if (nodeGraphLwwBroadcastRafHandle) {
    return;
  }
  nodeGraphLwwBroadcastRafHandle = window.requestAnimationFrame(nodeGraphLwwFlushPendingBroadcasts);
}
