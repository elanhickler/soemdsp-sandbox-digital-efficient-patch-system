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
  nodeGraphLwwMultiplayer.active = false;
  nodeGraphLwwMultiplayer.sessionId = null;
  nodeGraphLwwMultiplayer.doc = null;
  nodeGraphLwwMultiplayer.since = 0;
  nodeGraphLwwMultiplayer.pollTimer = 0;
}

// Called from syncNodeGraphPatchParameterFromSlider (node-graph-slider-dragging.js)
// after it writes a param value locally. Keeps this site's own LWW doc in
// sync (so a later remote merge has an up-to-date view of "what I've
// already changed") and broadcasts the edit -- fire-and-forget, since a
// dropped broadcast just means this specific value gets caught up on the
// next successful one for that field, not lost forever (LWW is idempotent).
function nodeGraphLwwNotifyLocalFieldEdit(nodeId, path, value) {
  if (!nodeGraphLwwMultiplayer.active || !nodeGraphLwwMultiplayer.doc) {
    return;
  }
  const updatedAt = Date.now();
  const siteId = nodeGraphLwwSiteId();
  nodeGraphLwwMultiplayer.doc = nodeGraphLwwApplyFieldEdit(nodeGraphLwwMultiplayer.doc, nodeId, path, value, updatedAt, siteId);
  nodeGraphLwwBroadcastEdit(nodeGraphLwwMultiplayer.sessionId, nodeId, path, value, updatedAt, siteId).catch(() => {});
}
