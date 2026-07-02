<div align="center">

# ⚙️ soemdsp-sandbox — Digital Efficient Patch System

*A fork of [soemdsp-sandbox-digital-signals-audio](https://github.com/elanhickler/soemdsp-sandbox-digital-signals-audio),*
*narrowing focus to one question:*
**how fast can loading, saving, and editing a patch be — and what does the graph have to look like underneath to eventually run on SIMD lanes?**

[![License: Noncommercial](https://img.shields.io/badge/license-noncommercial-blue.svg)](LICENSE)
[![Language: C++/WASM](https://img.shields.io/badge/native-C%2B%2B%20%E2%86%92%20WASM-654ff0.svg)](native_modules)
[![Runtime: Vanilla JS](https://img.shields.io/badge/runtime-vanilla%20JS-f7df1e.svg)](public)
[![Status: Investigating](https://img.shields.io/badge/status-investigating-orange.svg)](#)
[![Goal: SIMD-ready](https://img.shields.io/badge/goal-SIMD--ready-654ff0.svg)](#)

</div>

---

## 📖 Contents

- [Why this fork exists](#-why-this-fork-exists)
- [The real bottleneck (it isn't file size)](#-the-real-bottleneck-it-isnt-file-size--measured-not-guessed)
- [Phase 4, round 1: the heatmap fix](#-phase-4-round-1-the-heatmap-was-forcing-layout-on-every-edit)
- [Phase 4, round 2: a correct fix that didn't help](#-phase-4-round-2-a-correct-fix-that-turned-out-not-to-matter-reported-honestly)
- [Phase 4, round 3: why the layer read count wasn't the cost](#-phase-4-round-3-a-real-finding-and-why-it-stops-here-for-now)
- [The layering this has to respect](#-the-layering-this-has-to-respect)
- [The proof ladder](#-the-proof-ladder)
- [Where serialized connections meet SIMD and video](#-where-serialized-connections-meet-simd-and-video)
- [Diff-friendly online collaboration](#-the-same-shape-also-buys-diff-friendly-online-collaboration)
- [Plan of attack](#-plan-of-attack)
- [Running it](#-running-it)
- [License](#-license)

---

## 🎯 Why this fork exists

The question that started this: *"what's the best compression format we can do for our
patch system so loading/saving/editing is faster?"*

The honest answer turned out to be a redirect, not a format: today's patches
(`saved-patches/*.json`) are 1.6–18 KB of pretty-printed JSON. That's not a
transfer-speed problem — minifying or gzipping it would save milliseconds nobody
would notice. If saving, loading, or editing *feels* slow, the far more likely
culprit is what happens **after** the JSON is parsed: rebuilding the in-memory
graph, re-running normalizers, and reconstructing the execution plan every time a
patch changes.

So this fork's actual mission is two-layered:

1. **Short term:** profile and speed up the in-memory graph-rebuild step — the
   part that runs on every load, save, and edit, regardless of file format.
2. **Long term:** shape the graph's data model so that speeding it up further
   later (SIMD, block processing, a real scheduler) is a natural next step
   instead of a rewrite.

---

## 🔍 The real bottleneck (it isn't file size — measured, not guessed)

Before touching any serialization format, Phase 1 measured the actual pipeline
live in the browser, timing every stage of loading and committing the largest
demo patch (`lorenz-demonstration`, 17.6 KB, 7 nodes) with `performance.now()`,
median of 200 runs per stage:

| Stage | Median time |
|---|---|
| `JSON.parse` | **~0.0 ms** |
| `validateNodeGraphPatch` | **~0.1 ms** |
| `compileNodeGraphExecutionPlan` | **~0.1 ms** |
| `serializeNodeGraphPatch` | **~0.0 ms** |
| **Full `commitNodeGraphPatch` (one edit)** | **~110 ms** |

Parsing, validating, compiling the execution plan, and serializing back to
JSON are all effectively free — **under half a millisecond combined.** The
110 ms is coming from somewhere else entirely. Breaking `commitNodeGraphPatch`
down into its actual sub-calls (same methodology) found it:

| Sub-call inside `commitNodeGraphPatch` | Median time | Share |
|---|---|---|
| `applyNodeGraphPatchToDom` | **~57 ms** | ~50% |
| `applyNodeGraphZoom` | **~21 ms** | ~19% |
| `renderNodeGraphConnectionList` | **~11 ms** | ~10% |
| `syncNodeGraphMonitorIndicators` | ~5 ms | ~5% |
| everything else (validate, clone, runtime sync, palette, ghost sliders, filter curves, visual settings, settings view) | **< 1 ms total** | ~1% |

**Finding: this was never a serialization problem.** It's a DOM-rebuild
problem — `applyNodeGraphPatchToDom` alone is ~500x slower than parsing the
entire patch file. Any compression/binary-format work on the *file* would
shave sub-millisecond savings off a 110 ms edit. The actual target for Phase 3
is now clear: **why does applying a 7-node patch to the DOM cost 57 ms, and
does it need to fully rebuild rather than diff against what's already
rendered?**

### 🩹 Phase 4, round 1: the heatmap was forcing layout on every edit

Breaking `applyNodeGraphPatchToDom` itself down further (same monkey-patch-and-time
methodology, applied live in the running app) found two disproportionate costs
inside it:

| Sub-call inside `applyNodeGraphPatchToDom` | Median time |
|---|---|
| `applyNodeGraphWorkspaceView` | **~17 ms** |
| `updateNodeGraphGridHeatmap` | **~13 ms** |
| `renderNodeGraphCameraView` | ~7 ms |
| everything else instrumented | < 2 ms |
| *(remaining, the per-node update loop itself)* | ~39 ms |

Root cause for `updateNodeGraphGridHeatmap`: it reads `node.offsetWidth` /
`node.offsetHeight` and `getComputedStyle(...)` for every visible node —
**right after** the per-node loop above it just finished writing CSS custom
properties on those same nodes. That write-then-read sequence forces a
synchronous browser layout (a well-known pattern called "layout thrashing")
on every single patch commit, purely to redraw a cosmetic glow/mask overlay
behind the nodes.

The fix (`public/node-graph-patch-core.js`): swap the synchronous
`updateNodeGraphGridHeatmap()` call for the already-existing
`scheduleNodeGraphGridHeatmapUpdate()` — a one-line change that defers the
heatmap repaint to the next animation frame instead of blocking the commit on
it, exactly the same deferral pattern already used for wire redraws
(`scheduleNodeGraphWireRedrawAfterLayout`) in the same function. No visual
change — the glow still updates, just one frame later, which is
imperceptible for a cosmetic overlay.

**Result, same measurement methodology, same patch:** median full
`commitNodeGraphPatch` dropped from **~113.6 ms to ~91.4 ms** — about **20%
faster per edit**, from a single deferred call.

`applyNodeGraphWorkspaceView`'s ~17 ms and the per-node loop's ~39 ms were
left untouched this round.

### 🩹 Phase 4, round 2: a correct fix that turned out not to matter (reported honestly)

Digging into `applyNodeGraphWorkspaceView`'s ~17 ms found it was **not**
`clampNodeGraphWorkspaceGridSizeToViewport` as the round-1 writeup guessed —
it was all inside `applyNodeGraphPan()`, which it calls. And `applyNodeGraphPan`
turned out to have the *exact same* synchronous `updateNodeGraphGridHeatmap()`
call as round 1's fix, on a second, separate call path (it also runs on every
live pan/zoom drag, not just on patch commit).

Applied the identical fix: swapped it for `scheduleNodeGraphGridHeatmapUpdate()`.
Same reasoning, same zero-visual-risk deferral, same pattern as round 1.

**Then measured it honestly instead of assuming it worked**, isolating repeated
`applyNodeGraphPan()` calls the way live dragging would exercise them
(`git stash` to get a true before/after on just this file): baseline median
**~17 ms**, after the fix **~20 ms** — no improvement, within noise, if
anything slightly worse. The reason: `nodeGraphRenderedOriginOffset()`, called
*earlier* in the same function, already calls `getBoundingClientRect()` on the
workspace — so the forced layout was already paid before the heatmap read
ever ran. Removing the heatmap's redundant read didn't remove the mandatory
reflow, because it wasn't the one causing it.

**The fix stayed in** — it's still strictly correct (one fewer redundant
forced-layout trigger, no visual change, same win it already proved in the
`commitNodeGraphPatch` path from round 1) — but it is **not** being credited
with a speedup it didn't produce in this scenario. The real remaining cost
for live pan/zoom is `nodeGraphRenderedOriginOffset`'s `getBoundingClientRect()`
call, which is the actual candidate for round 3.

### 🩹 Phase 4, round 3: a real finding, and why it stops here for now

`nodeGraphRenderedOriginOffset()` was calling `nodeGraphWorkspaceCenterOffset()`
and `nodeGraphRenderedPan()` back to back — and both independently ran their
*own* `getBoundingClientRect()` + `getComputedStyle()` on the same workspace
element, on the same tick, with no style write in between. That's a genuinely
redundant duplicate measurement, so it was refactored into one shared read
(`nodeGraphWorkspaceRectMetrics()`), passed into both — fully backward
compatible, every other caller of those two functions still works exactly as
before.

**Measured honestly again:** baseline ~17 ms, after the fix ~17.1 ms. No
change. The reason matters more than the fix: **a forced synchronous layout
is paid once, by whichever read happens first after a style write — reading
the same geometry a second time right after is nearly free**, because the
browser caches layout results until the next write invalidates them. Cutting
two redundant reads down to one doesn't remove the cost, because the cost was
never about *how many* reads happen — it's about the fact that *any* read
happens at all, synchronously, on a tick that just wrote styles.

That's the real lever for a further win: **stop reading `getBoundingClientRect()`
on every pan/zoom tick at all**, by caching the workspace's rect and border
metrics across calls and only re-measuring when the workspace's actual
geometry changes (a resize). That's a bigger, riskier change than rounds 1–3 —
`ResizeObserver` catches *size* changes but not pure *position* shifts (e.g. a
sidebar toggling, or the page scrolling), and this workspace rect feeds pixel-
accurate mouse-to-graph coordinate math, so a stale cached position would show
up as real, hard-to-notice pan/zoom drift rather than a crash. It deserves its
own proof — checking every place the workspace can move without resizing —
rather than a same-day fix on the back of round 3's smaller finding. Stopping
Phase 4 here for now with that documented as the next real target.

---

## 🧱 The layering this has to respect

<div align="center">
<img src="docs/assets/patch-system-layering.svg" alt="Five stacked layers — Human/Editor, Circuit/Runtime Graph, Binding (the bridge), DSP Memory, DSP Objects — with a Patch JSON load/save loop feeding back into the Runtime Graph layer" width="70%"/>
</div>

This is the non-negotiable part, carried over directly from the direction set
for Soundemote's execution graph as a whole:

```
Circuit / runtime graph          <- humans see nodes, ports, wires, presets
    -> node/parameter metadata
    -> DSP binding metadata      <- the bridge, and only the bridge
    -> externally owned DSP memory/state
    -> low-level DSP object      <- plain, fast, SIMD-compatible, UI-blind
```

The sacred invariant:

> **Circuit does not own concrete DSP objects. DSP objects do not know Circuit.
> Binding is the bridge.**

Patch efficiency work has to happen *above* and *around* this boundary, not by
collapsing it. A faster patch loader that works by letting the graph reach
into DSP objects directly would be a faster way to build the wrong thing —
pointer soup, hidden ownership, and code that can never vectorize. The graph
gets to be expressive and inspectable. The DSP layer underneath stays boring,
explicit, and contiguous, on purpose.

---

## 🪜 The proof ladder

Speed work here follows the same discipline as the binding work it sits on top
of: small, sequential proofs, not a leap to a scheduler.

```
parameter sync
    -> manual single-sample DSP chain
    -> resynced manual DSP chain
    -> manual block DSP chain
    -> repeated block proofs
    -> observe the common execution shape
    -> only then design a scheduler
```

Applied to patch load/save/edit specifically, that ladder becomes:

1. **Measure** — instrument today's load/save/edit path, get real numbers.
2. **Minify, don't restructure** — cut incidental JSON overhead (whitespace,
   redundant defaults) without changing the graph's data shape.
3. **Speed the rebuild, not the format** — attack whatever the profiler
   actually points at in the normalizer/execution-plan step.
4. **Only then** consider whether the in-memory *shape* of a loaded patch
   should change — and if it does, let that shape be pulled toward arrays of
   parameters and stable IDs (SIMD-friendly), not toward a bespoke binary
   blob invented in isolation.

No step here assumes the next one is needed. Each one only happens once the
previous one is proven.

---

## 🎛️ Where serialized connections meet SIMD and video

Two things on the horizon shape how "efficient" gets defined going forward,
even though neither is being built yet:

- **SIMD audio calculations.** The eventual DSP layer wants contiguous memory,
  stable parameter slots, and fixed-size block processing — arrays, not
  scattered per-node allocations. A patch format that already serializes
  connections as stable IDs and flat parameter lists, rather than nested
  object graphs, is one step closer to that memory shape without having
  committed to it early.
- **A work-in-progress video system.** If visual and audio signals eventually
  share the same graph, the same serialized-connections format needs to
  describe both without caring which one a given wire is. That argues for
  keeping the patch format about *structure and bindings*, not about audio
  specifically — the same reason `Circuit` isn't allowed to know about
  concrete DSP objects today.

Neither of these is a reason to build SIMD or video support now. They're a
reason not to paint the patch format into a corner that would make either one
harder later.

### 🤝 The same shape also buys diff-friendly online collaboration

There's a third reason to reach for stable IDs and flat structure, and it
converges on the exact same shape as SIMD instead of pulling in a different
direction:

- **Arrays are diff-hostile.** Today's `nodes: [...]` / `graphConnections: [...]`
  are positional — inserting one node shifts every array index after it, so a
  naive diff sees "everything changed" instead of "one thing changed." Keying
  those collections by stable ID (`{ [nodeId]: node }`) turns a diff into "this
  one key changed" — which is both a clean collaboration diff *and* the
  stable-parameter-slot shape SIMD already wants.
- **Structural edits and cosmetic/session state shouldn't merge as one unit.**
  Two collaborators moving a slider and scrolling the view shouldn't be able
  to collide with each other's actual graph edits. Keeping view/window state
  (already mostly separate — `windows`, `view`, `cameras`) cleanly apart from
  graph structure (`nodes`, `connections`, `modulations`) means a future
  merge/diff only has to reconcile the parts that are actually collaborative.

This isn't a reason to build multiplayer now. It's a reason for Phase 5's
"stable IDs and flat parameter arrays" reshape — which is already the plan —
to be evaluated against *both* SIMD and diff/merge-friendliness at once,
since one well-shaped format serves both instead of trading one off against
the other.

---

## 🗺️ Plan of attack

| Phase | Goal | Status |
|---|---|---|
| 1 | Profile real load/save/edit timings on today's format | ✅ done — see numbers above |
| 2 | Minify JSON output, measure the delta | ⏸️ deprioritized — Phase 1 showed parse/serialize is <1ms; not the bottleneck |
| 3 | Identify the actual hot path in normalize/rebuild | ✅ done — it's DOM rebuild, not normalize/rebuild: `applyNodeGraphPatchToDom` (~50%), `applyNodeGraphZoom` (~19%), `renderNodeGraphConnectionList` (~10%) |
| 4 | Targeted fix for the hot path, re-measure | ⏸️ paused after round 3 — see write-up. Round 1: deferred heatmap in commit path (~113.6ms → ~91.4ms, ~20% faster). Round 2: same deferral in pan/zoom path (correct, no measured win — layout was already forced earlier). Round 3: merged two redundant `getBoundingClientRect()` reads into one (correct, still no measured win — the cost is *that a read happens*, not *how many*). Real fix (caching workspace rect, invalidated on resize) needs its own proof before attempting — deliberately not rushed |
| 5 | Only if still warranted: reshape in-memory + serialized patch data toward stable-ID-keyed collections (serves SIMD *and* diff-friendly collaboration at once) | 🔲 not started |

This table is the honest state of things: a plan, not a changelog. Phase 1's
own numbers reordered the plan — they pointed straight past JSON format and
straight at DOM rebuild cost, so Phase 2 (minify) is parked and Phase 3
(find the hot path) is already answered by the same measurement pass.

---

## ▶️ Running it

```powershell
# Requirements: Python 3, a modern browser. No package install needed.

git clone https://github.com/elanhickler/soemdsp-sandbox-digital-efficient-patch-system.git
cd soemdsp-sandbox-digital-efficient-patch-system

python server.py
# open http://127.0.0.1:8765

python scripts\smoke_test.py
```

---

## 📄 License

Source-available for noncommercial use only, same as upstream. Commercial use
requires a separate written commercial license from Soundemote. See
[`LICENSE`](LICENSE).

<div align="center">

*Measure first. Optimize second. Never the other way around.*

</div>
