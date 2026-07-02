// Bridges the pure LWW merge engine (node-graph-patch-lww-merge.js) to the
// live running app. Still no networking here -- this proves "given a merged
// doc, correctly apply it to the currently open patch" in isolation, which
// is the other half of the pipeline a real transport would eventually drive.
// See README.md Phase 6 for why the pure-engine and live-apply steps are
// deliberately separate proofs.

// The LWW engine doesn't track paramMeta (it's slider/UI metadata, not
// user-edited state) -- carry it over from the currently open patch's
// matching node by id when reconstructing, so slider display config isn't
// lost on a merge. Falls back to validateNodeGraphPatch's own defaults
// (nodeGraphParameterDefinitionMetadata) if the node is new and has none.
function nodeGraphLwwPreservedParamMeta(nodeId, basePatch) {
  return basePatch?.nodes?.find((node) => node.id === nodeId)?.paramMeta;
}

// A node deleted by the merge (via tombstone) can still be referenced by a
// connection in basePatch.connections/graphConnections -- validateNodeGraphPatch
// (node-graph-patch-core.js) THROWS on a connection referencing a missing
// node rather than silently dropping it (verified by reading its source
// before writing this, not assumed). So dangling connections have to be
// filtered out here, before the merged patch ever reaches commit.
function nodeGraphLwwDropDanglingConnections(connections, survivingNodeIds) {
  return (Array.isArray(connections) ? connections : []).filter(
    (connection) => survivingNodeIds.has(connection.sourceNode) && survivingNodeIds.has(connection.destinationNode),
  );
}

// Converts a merged LWW doc into a full patch object, ready for
// commitNodeGraphPatch -- everything outside `nodes` (view, windows,
// cameras, etc.) is carried over from basePatch untouched, since the LWW
// engine only governs node existence and node fields.
function nodeGraphLwwMergedDocToPatch(mergedDoc, basePatch = nodeGraphMvp.patch) {
  const nodesRecord = nodeGraphLwwDocToNodesRecord(mergedDoc);
  const nodesArray = Object.values(nodesRecord).map((node) => {
    const paramMeta = nodeGraphLwwPreservedParamMeta(node.id, basePatch);
    return paramMeta ? { ...node, paramMeta } : node;
  });
  const survivingNodeIds = new Set(nodesArray.map((node) => node.id));

  return {
    ...basePatch,
    nodes: nodesArray,
    connections: nodeGraphLwwDropDanglingConnections(basePatch.connections, survivingNodeIds),
    graphConnections: nodeGraphLwwDropDanglingConnections(basePatch.graphConnections, survivingNodeIds),
  };
}

// Applies a merged doc to the live, running patch via the same
// commitNodeGraphPatch every other edit path in the app already uses --
// same DOM sync, same execution-plan rebuild, same undo-history recording.
// A remote merge is not a special case to the rest of the app; it's just
// another patch commit.
function nodeGraphLwwApplyMergedDocToLivePatch(mergedDoc, options = {}) {
  const nextPatch = nodeGraphLwwMergedDocToPatch(mergedDoc, nodeGraphMvp.patch);
  commitNodeGraphPatch(nextPatch, { status: "merged remote changes", ...options });
}
