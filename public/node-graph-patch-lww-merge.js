// Phase 6 (multiplayer prerequisite): a standalone, pure last-writer-wins
// (LWW) merge engine for patch nodes. This file does NOT touch the live
// editor, commitNodeGraphPatch, or any networking -- it only proves the
// merge math works, in isolation, before anything gets wired to a transport.
// See README.md "Plan of attack" for why this order matters.
//
// Builds on Phase 5's keyed-by-id nodes shape ({ [nodeId]: node }). A "doc"
// here is the CRDT-friendly representation of a patch's nodes:
//   {
//     tombstones: { [nodeId]: { deleted: bool, updatedAt, siteId } },
//     fields:     { [fieldKey]: { value, updatedAt, siteId } },
//   }
// fieldKey is "<nodeId>::<fieldPath>", e.g. "osc1::params.frequency".
// Only position (gx/gy) and params.* are tracked as mergeable fields --
// `type` and `id` are identity, not something two people "merge" a change to.

const nodeGraphLwwFieldKeySeparator = "::";

function nodeGraphLwwFieldKey(nodeId, path) {
  return `${nodeId}${nodeGraphLwwFieldKeySeparator}${path}`;
}

function nodeGraphLwwParseFieldKey(fieldKey) {
  const separatorIndex = fieldKey.indexOf(nodeGraphLwwFieldKeySeparator);
  return {
    nodeId: fieldKey.slice(0, separatorIndex),
    path: fieldKey.slice(separatorIndex + nodeGraphLwwFieldKeySeparator.length),
  };
}

function nodeGraphLwwFieldPathsForNode(node) {
  const paths = ["gx", "gy"];
  for (const key of Object.keys(node?.params || {})) {
    paths.push(`params.${key}`);
  }
  return paths;
}

function nodeGraphLwwReadFieldValue(node, path) {
  if (path === "gx" || path === "gy") {
    return node[path];
  }
  if (path.startsWith("params.")) {
    return node.params?.[path.slice("params.".length)];
  }
  return undefined;
}

// Converts a Phase-5-shape keyed nodes record into an LWW doc, stamping
// every field and every node's existence with the same (updatedAt, siteId)
// -- the natural snapshot you'd take when a site first has a patch loaded,
// before any further edits diverge.
function nodeGraphLwwDocFromNodesRecord(nodesRecord = {}, updatedAt = 0, siteId = "") {
  const tombstones = {};
  const fields = {};
  for (const [nodeId, node] of Object.entries(nodesRecord)) {
    tombstones[nodeId] = { deleted: false, updatedAt, siteId, type: node.type };
    for (const path of nodeGraphLwwFieldPathsForNode(node)) {
      fields[nodeGraphLwwFieldKey(nodeId, path)] = {
        value: nodeGraphLwwReadFieldValue(node, path),
        updatedAt,
        siteId,
      };
    }
  }
  return { tombstones, fields };
}

// Deterministic LWW winner: higher updatedAt wins; on an exact tie, higher
// siteId (string compare) wins. This tiebreak is what makes the merge
// associative/commutative/idempotent regardless of call order -- a real CRDT
// requirement, not just "good enough in practice".
function nodeGraphLwwWins(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.updatedAt !== incumbent.updatedAt) {
    return candidate.updatedAt > incumbent.updatedAt;
  }
  return String(candidate.siteId) > String(incumbent.siteId);
}

function nodeGraphLwwMergeRecordMaps(mapA = {}, mapB = {}) {
  const merged = {};
  for (const key of new Set([...Object.keys(mapA), ...Object.keys(mapB)])) {
    const a = mapA[key];
    const b = mapB[key];
    if (a && !b) {
      merged[key] = a;
    } else if (b && !a) {
      merged[key] = b;
    } else {
      merged[key] = nodeGraphLwwWins(a, b) ? a : b;
    }
  }
  return merged;
}

// The actual merge: union of tombstones (node existence) and union of
// fields, each resolved independently by LWW. Two edits to two different
// fields on the same node both survive -- neither clobbers the other,
// unlike a naive "whole node" last-writer-wins would produce.
function nodeGraphLwwMerge(docA, docB) {
  return {
    tombstones: nodeGraphLwwMergeRecordMaps(docA?.tombstones, docB?.tombstones),
    fields: nodeGraphLwwMergeRecordMaps(docA?.fields, docB?.fields),
  };
}

// Applies a single field edit to a doc, returning a new doc (does not
// mutate the input) -- this is the shape a live editor or a network delta
// would call on every keystroke/param change, once wired up.
function nodeGraphLwwApplyFieldEdit(doc, nodeId, path, value, updatedAt, siteId) {
  const fieldKey = nodeGraphLwwFieldKey(nodeId, path);
  const existing = doc.fields[fieldKey];
  const candidate = { value, updatedAt, siteId };
  if (!nodeGraphLwwWins(candidate, existing)) {
    return doc;
  }
  return {
    tombstones: doc.tombstones,
    fields: { ...doc.fields, [fieldKey]: candidate },
  };
}

function nodeGraphLwwApplyNodeDelete(doc, nodeId, updatedAt, siteId) {
  const existing = doc.tombstones[nodeId];
  const candidate = { deleted: true, updatedAt, siteId, type: existing?.type };
  if (!nodeGraphLwwWins(candidate, existing)) {
    return doc;
  }
  return {
    tombstones: { ...doc.tombstones, [nodeId]: candidate },
    fields: doc.fields,
  };
}

// Reconstructs a Phase-5-shape keyed nodes record from a merged doc.
// Nodes whose tombstone says deleted are excluded. paramMeta is not tracked
// by this merge engine (metadata, not user-edited state) -- callers that
// need it should carry it through separately, keyed by the same node ids.
function nodeGraphLwwDocToNodesRecord(doc) {
  const record = {};
  for (const [nodeId, tombstone] of Object.entries(doc.tombstones || {})) {
    if (tombstone.deleted) {
      continue;
    }
    record[nodeId] = { id: nodeId, type: tombstone.type, params: {} };
  }
  for (const [fieldKey, field] of Object.entries(doc.fields || {})) {
    const { nodeId, path } = nodeGraphLwwParseFieldKey(fieldKey);
    const node = record[nodeId];
    if (!node) {
      continue;
    }
    if (path === "gx" || path === "gy") {
      node[path] = field.value;
    } else if (path.startsWith("params.")) {
      node.params[path.slice("params.".length)] = field.value;
    }
  }
  return record;
}
