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
- [The real bottleneck (probably isn't file size)](#-the-real-bottleneck-probably-isnt-file-size)
- [The layering this has to respect](#-the-layering-this-has-to-respect)
- [The proof ladder](#-the-proof-ladder)
- [Where serialized connections meet SIMD and video](#-where-serialized-connections-meet-simd-and-video)
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

## 🔍 The real bottleneck (probably isn't file size)

Before touching any serialization format, the plan is to actually measure:

- Time spent in `node-graph-patch-serialization.js` (parse/stringify) vs.
- Time spent in `node-graph-patch-normalizers.js` (validating and filling in
  every node/port/connection) vs.
- Time spent rebuilding the execution plan (`node-graph-execution-plan.js`) and
  re-hydrating every module's live state (the same 8-touch-point state-map
  pattern used for every stateful module today).

Whichever of those dominates is where the real win lives. Changing JSON→binary
without that measurement first would be optimizing the part of the pipeline
that was never slow.

---

## 🧱 The layering this has to respect

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

---

## 🗺️ Plan of attack

| Phase | Goal | Status |
|---|---|---|
| 1 | Profile real load/save/edit timings on today's format | 🔲 not started |
| 2 | Minify JSON output, measure the delta | 🔲 not started |
| 3 | Identify the actual hot path in normalize/rebuild | 🔲 not started |
| 4 | Targeted fix for the hot path, re-measure | 🔲 not started |
| 5 | Only if still warranted: reshape in-memory patch data toward stable IDs / flat parameter arrays | 🔲 not started |

This table is the honest state of things: a plan, not a changelog. Nothing
below Phase 1 gets built until Phase 1 produces numbers.

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
