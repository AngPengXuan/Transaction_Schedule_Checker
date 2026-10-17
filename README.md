# Schedule Checker

A calculator for the CS3223 schedule properties. Type in a schedule such as
`R1(A) W2(A) R2(B) W1(B) C1 C2` and it checks the schedule against six
properties. Each check explains its verdict, and hovering over an edge or a
violation highlights the operations behind it.

| Property | Rule |
|---|---|
| Serial | Each transaction finishes (C or A) before the next one begins. |
| Conflict serializable | The precedence graph has no cycle. Edge Ti → Tj for each Ri(x) → Wj(x), Wi(x) → Rj(x) or Wi(x) → Wj(x). |
| View serializable | Some way of resolving the rule (c) choices gives an acyclic graph (see below). |
| Recoverable | If Tj reads from Ti, then Ti commits before Tj commits. |
| Avoids cascading aborts | If Tj reads from Ti, then Ti commits before that read. |
| Strict | Nothing reads or overwrites a value until its writer commits or aborts. |

Companion to the
[B+ tree](https://github.com/AngPengXuan/CS3223_B-Tree_Visualiser) and
[hash index](https://github.com/AngPengXuan/CS3223_Hash_Index_Visualiser) visualisers.

## The view serializability graph

The graph has a virtual transaction **T0**, which wrote every object's initial
value. Edges come from three rules:

- **(a)** If Tj reads O from Ti, add Ti → Tj.
- **(b)** If Ti makes the final write on O, add Tj → Ti for every other Tj that updates O, including T0.
- **(c)** If Tj reads O from Tk and Ti updates O, add Ti → Tk **or** Tj → Ti.

Rule (c) is resolved in one of three ways:

- **Forced.** When Tk is T0, Ti → T0 is impossible, so the edge must be Tj → Ti.
- **Already satisfied.** When one option is already in the graph, the choice adds nothing.
- **Open.** Otherwise the choice stays open. Each open choice doubles the
  number of possible graphs. The app draws every distinct graph, marks the
  acyclic ones, and gives each one's serial order.

Rule (c) also applies when Ti is Tk or Tj itself. One option is then a
self-loop, which is impossible, so the other option is forced. This only
applies when that transaction's own write would fall between the write and the
read:

- **Ti = Tk.** Tk writes O again after the write that Tj read, as in
  `W1(X) R2(X) W1(X)`. In any serial order Tj would see Tk's last write
  instead, so Tj → Tk is forced. With (a) Tk → Tj, that closes a cycle.
- **Ti = Tj.** Tj wrote O itself before reading it from Tk. In any serial order
  Tj would see its own write instead, so Tj → Tk is forced.

The extra edge cannot be added in every case. If it were, then whenever one
transaction reads from another, it would close a cycle with (a). That would
mark even a serial `W1(A) C1 R2(A) W2(A) C2` as not view serializable.

The app also checks the VSS verdict a second way, by trying every serial order
of up to 7 transactions. The VSS card lists the view-equivalent serial orders
this finds. Two schedules count as view-equivalent only when every read sees the
same write operation, not just a write by the same transaction.

## Conventions

| | |
|---|---|
| Input | `R1(A)`, `W2(B)`, `C1`, `A2`, separated by spaces or commas. `r1[a]` also works. |
| Committed projection | CSS and VSS ignore aborted transactions. A transaction with no C or A counts as committed. |
| Recoverability | Uses the full schedule. A write from a transaction that aborted before a read has been rolled back, so the read does not see it. A transaction with no C or A counts as not committed. |

## Running it

```bash
npm install
npm run dev
```

## Layout

The app is split into a shared core and one folder per page, so that future
pages (MVCC, multi-database) can reuse the parser, graphs and cards. Pages are
switched by URL hash (`#/`, `#/mvcc`, …), which works on GitHub Pages without a
server.

| File | |
|---|---|
| `src/App.tsx` | The shell: title, page tabs, hash routing |
| `src/pages/registry.ts` | The list of pages; an entry with no component shows as "soon" |
| `src/core/schedule.ts` | Parsing, and the committed projection |
| `src/core/graph.ts` | Edge model, cycle finding, topological order |
| `src/core/polygraph.ts` | View-serializability graph: rules (a), (b), (c), choice enumeration, and the check that tries every serial order. Takes reads-from as input, so MVCC can supply it from versioned reads. |
| `src/core/verdict.ts`, `format.ts` | Verdict types and shared text helpers |
| `src/core/components/` | GraphView, ScheduleGrid, and the cards and edge lists |
| `src/pages/classic/analysis.ts` | Serial, CSS, VSS and recoverability checks |
| `src/pages/classic/presets.ts` | One example per region (S1–S12, Serial), plus special cases |
| `src/pages/classic/RegionMap.tsx` | The S1–S12 region diagram |
| `src/pages/classic/ClassicPage.tsx` | The page itself |
