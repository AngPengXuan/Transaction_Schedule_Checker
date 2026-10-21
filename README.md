# Schedule Checker

A calculator for transaction schedules. Type in a schedule such as
`R1(A) W2(A) R2(B) W1(B) C1 C2` and it checks it against the properties
below. Each check explains its verdict, and hovering over an edge or a
violation highlights the operations behind it.

There are three pages, one tab each:

| Page | Course | Checks |
|---|---|---|
| **Classic** (`#/`) | CS3223 | Serial, CSS, VSS, recoverable, ACA, strict |
| **Concurrency control** (`#/cc`; `#/mvcc` still works) | CS3223 | Locking: 2PL, strict 2PL, deadlock handling. Multiple versions: MVSS, snapshot isolation, serializable SI |
| **Multi-database** (`#/distributed`) | CS4224 | Local vs global serializability, strict 2PL, per-database snapshots |

The Classic page's properties:

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

The graph can be drawn two ways, chosen by a toggle above the VSS graphs. Both
give the same verdicts and serial orders.

### AY26/27 Sem 1 (default), as in the current lecture slides

- **Nodes:** every transaction, plus T0, which wrote the initial values, and
  **Tf**, which reads every written object after the schedule ends.
- **Edges:**
  - If Ti reads X from Tj, add Tj → Ti, so each final writer gets an arc to Tf.
  - If Ti reads X from Tj and Tk also writes X, add Tk → Tj **or** Ti → Tk.
    - If Tj is T0, only Ti → Tk.
    - If Ti is Tf, only Tk → Tj. This is where the final-write requirement comes in.

### AY25/26 Sem 2

No Tf node. Rule (b) states the final-write requirement directly: every other
writer of O, including T0, comes before the final writer.

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

## Concurrency control page

### Locking

| Check | Rule |
|---|---|
| Strict 2PL | 2PL, and every lock held until the transaction commits or aborts |
| Two-phase locking (2PL) | S lock to read, X lock to write (upgrading S to X allowed), incompatible locks never held together, no lock acquired after the first unlock |
| Conflict serializable | As on the Classic page |

These form the chain from the slides: Strict 2PL ⊂ 2PL ⊂ CSS.

**How 2PL is checked.** Every transaction has a lock point: all its
acquisitions come before it, all its releases after. So each lock is held over
an interval containing the lock point and every use of the object. Given the
lock points, the shortest such intervals are the least likely to clash. The
schedule is 2PL exactly when some choice of lock points makes those shortest
intervals compatible, and the app searches every choice. When one works, it
shows the schedule with the lock and unlock actions woven in. When none does,
it names the transaction whose lock point has no room, or explains why every
choice clashes.

**Replay under strict 2PL.** The schedule is read as the order requests
arrive and sent through a lock manager. A refused request waits, and the
transaction's later operations queue behind it. Conflicts are handled one of
three ways, as in the slides:

- **Detect deadlocks:** wait, and when the wait-for graph gets a cycle, abort
  the youngest transaction on it.
- **Wait-die:** an older requester waits; a younger one aborts.
- **Wound-wait:** an older requester aborts the younger holder; a younger
  requester waits.

Timestamps are arrival order, so the first transaction to appear is oldest.
Aborted transactions are not restarted. The log shows each grant, wait, queued
operation and abort, and draws the wait-for graph at each deadlock.

Locking assumes one version of each object, so these checks are marked not
applicable when a read names an older version.

**Not covered yet:** validation-based (optimistic) control, which needs each
transaction's validation point; timestamp ordering; multiple-granularity
locking.

### Multiple versions

A read may name the version it sees: `R1,2(A)` is T1 reading T2's version of
A, shown as `R1(A₂)`. `R1,0(A)` reads the initial version. A plain `R1(A)`
reads the latest earlier write. **Fill SI versions** rewrites every read to the
version snapshot isolation would give it.

| Check | Rule |
|---|---|
| VSS | Monoversion, and view serializable as an ordinary schedule |
| MVSS | Some serial monoversion schedule has the same reads-from. Drawn with the same polygraph as VSS, without the final-write condition (no Tf, no rule (b)). |
| Monoversion | Every read sees the latest earlier write |
| Serialization graph acyclic | wr, ww and rw edges, with each object's versions ordered by commit |
| Snapshot reads | Each read sees its own write, or the latest version committed before its transaction started |
| First-committer-wins | Of two concurrent transactions writing the same object, only the first to commit may |
| Allowed under SI | Snapshot reads and first-committer-wins both hold |
| Serializable SI | No dangerous structure: Tin →rw Tpivot →rw Tout between concurrent transactions |
| ACA, recoverable | As on the Classic page, using the versions actually read |

Conventions chosen without lecture slides to check against. Change these if
the course defines them differently:

- **MVSS compares reads-from only**, with no final-write condition. Under
  multiversioning, the final version of an object is fixed by the version
  order, not by which write happens last.
- **A transaction starts at its first operation**, and its snapshot is
  everything committed before then.
- **Version order is commit order**, for the serialization graph. That's the
  order snapshot isolation installs versions in.
- **A transaction must read its own version** once it has written an object.
  Reading another version after that is rejected when typed as `R1,2(A)`. With
  a plain read, it makes the schedule non-serializable.
- **First-updater-wins is not checked.** It depends on when write locks are
  taken, which a schedule alone doesn't show.
- **The SSI test is the conservative one:** any two consecutive rw edges
  between concurrent transactions. Real implementations also look at commit
  order to abort less often.

## Multi-database page

Declare which database holds which objects, one per line: `DB1: A, B`. Every
object goes in exactly one database. Each database sees only its share of the
schedule: its own objects' operations, plus the commits and aborts of the
transactions that ran there.

| Check | Rule |
|---|---|
| Strict 2PL at every database | Each database could have produced its share holding every lock until commit |
| Globally conflict serializable | The union of every database's precedence graph has no cycle |
| Each database conflict serializable | Every local graph, on its own, has no cycle |
| Consistent snapshots | Each transaction sees the same commits at every database it reads from |
| First-committer-wins | As on the MVCC page |

The serializability checks form a chain: S2PL at every database ⊂ globally CSS
⊂ every database CSS. The page also shows each database's local schedule and
graph, and what every read would see under a per-database snapshot versus one
global snapshot.

Conventions chosen without lecture slides to check against:

- **Commit is atomic.** `C1` takes effect at every database T1 touched, at the
  same moment, as two-phase commit gives. This is what makes "S2PL everywhere
  ⇒ globally serializable" hold.
- **Each database takes a transaction's snapshot at its first operation
  there**, not at a global start time. That's the gap that makes snapshots
  inconsistent.
- **S2PL holds read and write locks until commit or abort**, as in the CS3223
  notes. Only whether the schedule could have been produced is checked;
  deadlocks aren't simulated.

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
| `src/pages/registry.ts` | The list of pages. Pages not built yet are hidden unless `SHOW_UPCOMING` is on, which shows them as "soon" tabs |
| `src/core/schedule.ts` | Parsing, and the committed projection |
| `src/core/graph.ts` | Edge model, cycle finding, topological order |
| `src/core/polygraph.ts` | View-serializability graph: rules (a), (b), (c), choice enumeration, and the check that tries every serial order. Takes reads-from as input, so MVCC can supply it from versioned reads. |
| `src/core/verdict.ts`, `format.ts` | Verdict types and shared text helpers |
| `src/core/components/` | GraphView, ScheduleGrid, ViewGraphPanel (the VSS/MVSS graphs), and the cards and edge lists |
| `src/core/viewStyle.ts` | The AY26/27 Sem 1 / AY25/26 Sem 2 drawing toggle, shared by every page |
| `src/core/protocols/` | Lifetimes and concurrency, snapshot isolation, strict 2PL, the 2PL lock-point search (`twopl.ts`), the lock-manager replay (`lockSim.ts`) |
| `src/pages/classic/analysis.ts` | Serial, CSS, VSS and recoverability checks |
| `src/pages/classic/presets.ts` | One example per region (S1–S12, Serial), plus special cases |
| `src/pages/classic/RegionMap.tsx` | The S1–S12 region diagram |
| `src/pages/classic/ClassicPage.tsx` | The page itself |
| `src/pages/cc/` | Concurrency control: locking checks, lock plan, replay panel, multiversion checks, presets, page |
| `src/pages/distributed/` | Database declarations, local schedules, checks, presets and page |
