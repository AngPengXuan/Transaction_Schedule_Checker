/**
 * Replicated databases: one local schedule per site, where an object may have
 * a copy at several sites. A site holds a copy of every object its schedule
 * mentions. Transactions are global: T1 at S1 and T1 at S2 are the same T1.
 *
 * Operation indexes are made unique across sites (each site's are offset by
 * the lengths of the sites before it), so highlights never collide; `step`
 * gives an operation's position within its own site.
 */
import { cycleText, orderText } from '../../core/format';
import { addEdge, cycleArcs, findCycle, topoOrder } from '../../core/graph';
import type { Edge, Graph } from '../../core/graph';
import { opText, parseSchedule, T0, txnName } from '../../core/schedule';
import type { Op, Schedule, TxnStatus } from '../../core/schedule';
import type { Verdict, Violation } from '../../core/verdict';
import { checkCss } from '../classic/analysis';
import type { CssResult } from '../classic/analysis';

const T = txnName;

export interface SiteSchedule {
  name: string;
  schedule: Schedule;
  /** Index of this site's first operation in the combined numbering. */
  offset: number;
}

export interface ParsedSites {
  sites: SiteSchedule[];
  errors: string[];
}

/** Reads "S1: R1(X) W2(X) C1 C2" -- one site per line. */
export function parseLocalSchedules(raw: string): ParsedSites {
  const sites: SiteSchedule[] = [];
  const errors: string[] = [];
  let offset = 0;
  for (const line of raw.split('\n').map((l) => l.trim())) {
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon < 0) {
      errors.push(`"${line}" should start with a site name, like "S1: R1(X) W1(X) C1".`);
      continue;
    }
    const name = line.slice(0, colon).trim();
    if (sites.some((s) => s.name === name)) {
      errors.push(`${name} has two lines; put all of its operations on one.`);
      continue;
    }
    const parsed = parseSchedule(line.slice(colon + 1));
    if (parsed.errors.length > 0) {
      errors.push(...parsed.errors.map((e) => `${name}: ${e}`));
      continue;
    }
    if (!parsed.schedule) continue;
    const ops = parsed.schedule.ops.map((o) => ({ ...o, index: o.index + offset }));
    sites.push({ name, schedule: { ...parsed.schedule, ops }, offset });
    offset += ops.length;
  }
  return { sites, errors };
}

// ================================================================ checks

export interface LocalView {
  site: string;
  schedule: Schedule;
  css: CssResult;
}

export interface CopyRow {
  obj: string;
  /** For each site holding a copy: the committed transactions that wrote it, in order. */
  copies: { site: string; writers: number[] }[];
}

export interface RdsgResult extends Verdict {
  graph: Graph;
  cycle: number[] | null;
  order: number[] | null;
  /** The write order used, per object. */
  writeOrder: { obj: string; writers: number[] }[];
  /** How many write-order combinations were tried. */
  tried: number;
}

export interface ReplicatedAnalysis {
  sites: SiteSchedule[];
  txns: number[];
  committed: number[];
  locals: LocalView[];
  copies: CopyRow[];
  atomic: Verdict;
  localCss: Verdict;
  union: CssResult;
  rowa: Verdict;
  rdsg: RdsgResult;
  oneCopy: Verdict & { orders: number[][] | null };
  mutual: Verdict;
}

interface Read {
  site: string;
  read: Op;
  /** Who wrote the copy this read sees: a transaction, T0 for the initial value, or the reader itself. */
  source: number;
  write: Op | null;
}

/** Each transaction's outcome, the same at every site if commit is atomic. */
function outcomes(sites: SiteSchedule[], txns: number[]) {
  const status: Record<number, TxnStatus> = {};
  const violations: Violation[] = [];
  for (const t of txns) {
    const per = sites
      .filter((s) => s.schedule.txns.includes(t))
      .map((s) => ({ site: s.name, status: s.schedule.status[t], op: s.schedule.ops.find((o) => o.txn === t && (o.kind === 'C' || o.kind === 'A')) }));
    const kinds = new Set(per.map((p) => p.status));
    if (kinds.size > 1) {
      violations.push({
        text: `${T(t)} ends differently at different sites: ${per
          .map((p) => `${p.status === 'active' ? 'no commit' : p.status} at ${p.site}`)
          .join(', ')}.`,
        ops: per.flatMap((p) => (p.op ? [p.op.index] : [])),
      });
    }
    // Committed only if it committed everywhere; any abort aborts it.
    status[t] = kinds.has('aborted') ? 'aborted' : kinds.size === 1 && kinds.has('committed') ? 'committed' : kinds.has('committed') ? 'aborted' : 'active';
  }
  return { status, violations };
}

export function analyseReplicated(sites: SiteSchedule[]): ReplicatedAnalysis {
  const txns = [...new Set(sites.flatMap((s) => s.schedule.txns))].sort((a, b) => a - b);
  const { status, violations: atomicViolations } = outcomes(sites, txns);
  // Unfinished transactions count as committed, as on the other pages.
  const committed = txns.filter((t) => status[t] !== 'aborted');
  const live = (t: number) => committed.includes(t);

  const locals: LocalView[] = sites.map((s) => {
    const schedule: Schedule = { ...s.schedule, status: { ...s.schedule.status, ...Object.fromEntries(s.schedule.txns.map((t) => [t, status[t]])) } };
    return { site: s.name, schedule, css: checkCss(schedule) };
  });

  const objects = [...new Set(sites.flatMap((s) => s.schedule.objects))].sort();
  const holders = (obj: string) => sites.filter((s) => s.schedule.objects.includes(obj)).map((s) => s.name);
  const opsAt = (site: string) => sites.find((s) => s.name === site)!.schedule.ops;

  // ---- copies and their write sequences
  const copies: CopyRow[] = objects.map((obj) => ({
    obj,
    copies: holders(obj).map((site) => {
      const writers: number[] = [];
      for (const o of opsAt(site)) {
        if (o.kind === 'W' && o.obj === obj && live(o.txn) && writers[writers.length - 1] !== o.txn) writers.push(o.txn);
      }
      return { site, writers };
    }),
  }));

  // ---- reads, per copy
  const reads: Read[] = [];
  for (const s of sites) {
    for (const r of s.schedule.ops) {
      if (r.kind !== 'R' || !live(r.txn)) continue;
      let write: Op | null = null;
      for (const o of s.schedule.ops) {
        if (o.index >= r.index) break;
        if (o.kind === 'W' && o.obj === r.obj && live(o.txn)) write = o;
      }
      reads.push({ site: s.name, read: r, source: write ? write.txn : T0, write });
    }
  }

  // ---- union of the local precedence graphs
  const unionEdges: Edge[] = [];
  for (const l of locals) {
    for (const e of l.css.graph.edges) addEdge(unionEdges, { ...e, reasons: e.reasons.map((r) => `${r} at ${l.site}`) });
  }
  const unionGraph = { nodes: committed, edges: unionEdges };
  const unionCycle = findCycle(unionGraph);
  const unionOrder = unionCycle ? null : topoOrder(unionGraph);
  const failing = locals.filter((l) => !l.css.holds);
  const union: CssResult = {
    graph: unionGraph,
    cycle: unionCycle,
    order: unionOrder,
    holds: unionCycle === null,
    summary: unionCycle
      ? failing.length === 0
        ? `Every site is serializable on its own, but their union has a cycle: ${cycleText(unionCycle)}.`
        : `The union of the local graphs has a cycle: ${cycleText(unionCycle)}.`
      : `Acyclic: ${orderText(unionOrder!)} is consistent with every site.`,
    violations: unionCycle
      ? [{ text: `Cycle ${cycleText(unionCycle)}.`, ops: unionEdges.filter((e) => cycleArcs(unionCycle).has(`${e.from}>${e.to}`)).flatMap((e) => e.ops) }]
      : [],
  };

  // ---- read-one-write-all
  const rowaViolations: Violation[] = [];
  for (const obj of objects) {
    const at = holders(obj);
    for (const t of committed) {
      const wroteAt = at.filter((site) => opsAt(site).some((o) => o.kind === 'W' && o.txn === t && o.obj === obj));
      if (wroteAt.length === 0 || wroteAt.length === at.length) continue;
      const missed = at.filter((site) => !wroteAt.includes(site));
      rowaViolations.push({
        text: `${T(t)} writes ${obj} at ${wroteAt.join(', ')} but not at ${missed.join(', ')}, which ${missed.length === 1 ? 'also holds a copy' : 'also hold copies'}.`,
        ops: wroteAt.flatMap((site) => opsAt(site).filter((o) => o.kind === 'W' && o.txn === t && o.obj === obj).map((o) => o.index)),
      });
    }
  }

  // ---- mutual consistency
  const mutualViolations: Violation[] = [];
  for (const row of copies) {
    if (row.copies.length < 2) continue;
    const finals = row.copies.map((c) => ({ site: c.site, last: c.writers.length > 0 ? c.writers[c.writers.length - 1] : T0 }));
    if (new Set(finals.map((f) => f.last)).size > 1) {
      mutualViolations.push({
        text: `The copies of ${row.obj} end differently: ${finals
          .map((f) => `${f.site} ends with ${f.last === T0 ? 'the initial value' : `${T(f.last)}'s write`}`)
          .join(', ')}.`,
        ops: row.copies.flatMap((c) => opsAt(c.site).filter((o) => o.kind === 'W' && o.obj === row.obj && live(o.txn)).map((o) => o.index)),
      });
    }
  }

  const rdsg = buildRdsg(objects, committed, unionEdges, reads, copies);
  const oneCopy = checkOneCopy(objects, committed, reads, copies);

  return {
    sites,
    txns,
    committed,
    locals,
    copies,
    atomic: {
      holds: atomicViolations.length === 0,
      summary:
        atomicViolations.length === 0
          ? 'Every transaction ends the same way at every site it ran at.'
          : 'Some transaction commits at one site but not at another.',
      violations: atomicViolations,
    },
    localCss: {
      holds: failing.length === 0,
      summary:
        failing.length === 0
          ? 'Each site’s schedule is conflict serializable on its own.'
          : `${failing.map((l) => l.site).join(', ')} ${failing.length === 1 ? 'is' : 'are'} not conflict serializable even on its own.`,
      violations: failing.flatMap((l) => l.css.violations.map((v) => ({ ...v, text: `${l.site}: ${v.text}` }))),
    },
    union,
    rowa: {
      holds: rowaViolations.length === 0,
      summary:
        rowaViolations.length === 0
          ? 'Every write reaches every copy of its object.'
          : 'Some write misses a copy of its object.',
      violations: rowaViolations,
    },
    rdsg,
    oneCopy,
    mutual: {
      holds: mutualViolations.length === 0,
      summary:
        mutualViolations.length === 0
          ? 'Every copy of each object ends with the same final write.'
          : 'Some object’s copies end with different values.',
      violations: mutualViolations,
    },
  };
}

// ================================================================== RDSG

const MAX_COMBINATIONS = 20000;

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * The replicated data serialization graph: the union of the local graphs,
 * plus a write order on each object's writers, plus read-order edges -- if Tj
 * reads x from Ti and Tk writes x after Ti, then Tj → Tk. A virtual Tf reads
 * every copy's final value, so each copy's final writer must come last in its
 * object's write order. If some choice of write orders gives an acyclic
 * graph, the execution is one-copy serializable.
 */
function buildRdsg(objects: string[], committed: number[], unionEdges: Edge[], reads: Read[], copies: CopyRow[]): RdsgResult {
  const writersOf = (obj: string) => [...new Set(copies.find((c) => c.obj === obj)!.copies.flatMap((c) => c.writers))];
  const finalsOf = (obj: string) =>
    new Set(copies.find((c) => c.obj === obj)!.copies.filter((c) => c.writers.length > 0).map((c) => c.writers[c.writers.length - 1]));

  // Write orders per object, keeping only those whose last writer is every copy's final writer.
  const choices = objects.map((obj) => {
    const finals = finalsOf(obj);
    const all = permutations(writersOf(obj));
    const ok = finals.size <= 1 ? all.filter((p) => p.length === 0 || finals.has(p[p.length - 1]) || finals.size === 0) : [];
    return { obj, orders: ok };
  });

  const dead = choices.find((c) => c.orders.length === 0);
  if (dead) {
    const finals = [...finalsOf(dead.obj)];
    return {
      graph: { nodes: committed, edges: unionEdges },
      cycle: findCycle({ nodes: committed, edges: unionEdges }),
      order: null,
      writeOrder: [],
      tried: 0,
      holds: false,
      summary: `No write order works for ${dead.obj}: its copies end with different writers (${finals.map(T).join(', ')}), and only one of them can be last.`,
      violations: [],
    };
  }

  const build = (picks: number[][]) => {
    const edges: Edge[] = [...unionEdges];
    choices.forEach((c, k) => {
      const order = picks[k];
      for (let i = 1; i < order.length; i++) {
        addEdge(edges, { from: order[i - 1], to: order[i], rule: 'b', ops: [], reasons: [`write order on ${c.obj}: ${T(order[i - 1])} before ${T(order[i])}`] });
      }
    });
    for (const r of reads) {
      if (r.source === r.read.txn) continue;
      const obj = r.read.obj!;
      const order = picks[choices.findIndex((c) => c.obj === obj)];
      const after = r.source === T0 ? order : order.slice(order.indexOf(r.source) + 1);
      for (const k of after) {
        if (k === r.read.txn) continue;
        addEdge(edges, {
          from: r.read.txn,
          to: k,
          rule: 'c',
          ops: [r.read.index, ...(r.write ? [r.write.index] : [])],
          reasons: [
            `read order: ${opText(r.read)} at ${r.site} reads ${obj} from ${r.source === T0 ? 'the initial value' : T(r.source)}, and ${T(k)} writes ${obj} after that in the write order`,
          ],
        });
      }
    }
    return edges;
  };

  let tried = 0;
  let first: { picks: number[][]; edges: Edge[]; cycle: number[] | null } | null = null;
  const picks: number[][] = [];
  const search = (k: number): { picks: number[][]; edges: Edge[] } | null => {
    if (tried >= MAX_COMBINATIONS) return null;
    if (k === choices.length) {
      tried++;
      const edges = build(picks);
      const cycle = findCycle({ nodes: committed, edges });
      if (!first) first = { picks: picks.map((p) => [...p]), edges, cycle };
      return cycle ? null : { picks: picks.map((p) => [...p]), edges };
    }
    for (const order of choices[k].orders) {
      picks[k] = order;
      const found = search(k + 1);
      if (found) return found;
    }
    return null;
  };
  const found = search(0);
  const chosen = found ?? first!;
  const graph = { nodes: committed, edges: chosen.edges };
  const cycle = found ? null : findCycle(graph);
  const order = cycle ? null : topoOrder(graph);
  const writeOrder = choices.map((c, k) => ({ obj: c.obj, writers: chosen.picks[k] })).filter((w) => w.writers.length > 1);
  return {
    graph,
    cycle,
    order,
    writeOrder,
    tried,
    holds: cycle === null,
    summary: cycle
      ? `Every choice of write order gives a cycle (${tried} tried); for example ${cycleText(cycle)}.`
      : committed.length === 0
        ? 'Nothing commits, so there is nothing to serialize.'
        : `Acyclic with the write order shown, so one-copy serializable as ${orderText(order!)}.`,
    violations: cycle
      ? [{ text: `Cycle ${cycleText(cycle)}.`, ops: chosen.edges.filter((e) => cycleArcs(cycle).has(`${e.from}>${e.to}`)).flatMap((e) => e.ops) }]
      : [],
  };
}

// ========================================================= by definition

const MAX_BRUTE_FORCE_TXNS = 7;

/**
 * One-copy serializability straight from the definition: some serial order
 * of the committed transactions, run on a single copy of each object, gives
 * every read the same source, and leaves each object with the value every
 * written copy ends with.
 */
function checkOneCopy(objects: string[], committed: number[], reads: Read[], copies: CopyRow[]): Verdict & { orders: number[][] | null } {
  if (committed.length > MAX_BRUTE_FORCE_TXNS) {
    return { holds: false, summary: `Too many transactions to try every order (more than ${MAX_BRUTE_FORCE_TXNS}).`, violations: [], orders: null };
  }
  const writes = (t: number, obj: string) => copies.find((c) => c.obj === obj)!.copies.some((c) => c.writers.includes(t));
  const finals = objects.map((obj) => ({
    obj,
    lasts: copies.find((c) => c.obj === obj)!.copies.filter((c) => c.writers.length > 0).map((c) => c.writers[c.writers.length - 1]),
  }));
  const orders = permutations(committed).filter((order) => {
    for (const r of reads) {
      if (r.source === r.read.txn) continue;
      const obj = r.read.obj!;
      let source = T0;
      for (const t of order) {
        if (t === r.read.txn) break;
        if (writes(t, obj)) source = t;
      }
      if (source !== r.source) return false;
    }
    for (const f of finals) {
      if (f.lasts.length === 0) continue;
      const last = [...order].reverse().find((t) => writes(t, f.obj));
      if (f.lasts.some((l) => l !== last)) return false;
    }
    return true;
  });
  return {
    holds: orders.length > 0,
    summary:
      committed.length === 0
        ? 'Nothing commits, so there is nothing to serialize.'
        : orders.length > 0
        ? `Equivalent to the serial one-copy execution ${orders.map(orderText).join(', ')}.`
        : 'No serial order on single copies gives every read the same value and every object the same final value.',
    violations: [],
    orders,
  };
}
