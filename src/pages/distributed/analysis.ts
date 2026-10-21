/**
 * The multi-database page's checks. Each object lives in exactly one
 * database; a transaction's commit or abort happens at every database it
 * touched at once (atomic commit). Each database sees only its own share of
 * the global schedule -- its local schedule.
 */
import { cycleText, orderText } from '../../core/format';
import { addEdge, cycleArcs, findCycle, topoOrder } from '../../core/graph';
import type { Edge, Graph } from '../../core/graph';
import { lifetimes } from '../../core/protocols/lifetime';
import { checkS2pl } from '../../core/protocols/s2pl';
import { checkFirstCommitterWins, seenVersion, snapshotVersion } from '../../core/protocols/si';
import { opText, T0, txnName } from '../../core/schedule';
import type { Op, Schedule } from '../../core/schedule';
import type { Verdict, Violation } from '../../core/verdict';
import { checkCss } from '../classic/analysis';
import type { CssResult } from '../classic/analysis';

const T = txnName;

// ================================================================= sites

export interface Site {
  name: string;
  objects: string[];
}

export interface ParsedSites {
  sites: Site[];
  errors: string[];
}

/**
 * Reads "DB1: A, B; DB2: C" -- one database per line or semicolon, its
 * objects after the colon. Every object the schedule uses must be placed in
 * exactly one database.
 */
export function parseSites(raw: string, used: string[]): ParsedSites {
  const sites: Site[] = [];
  const errors: string[] = [];
  const placed = new Map<string, string>();
  for (const entry of raw.split(/[\n;]+/).map((e) => e.trim())) {
    if (entry === '') continue;
    const colon = entry.indexOf(':');
    if (colon < 0) {
      errors.push(`"${entry}" should look like "DB1: A, B".`);
      continue;
    }
    const name = entry.slice(0, colon).trim();
    if (name === '') {
      errors.push(`"${entry}" needs a database name before the colon.`);
      continue;
    }
    if (sites.some((x) => x.name === name)) {
      errors.push(`${name} is declared twice.`);
      continue;
    }
    const objects = entry
      .slice(colon + 1)
      .split(/[\s,]+/)
      .filter((o) => o !== '')
      .map((o) => o.toUpperCase());
    for (const o of objects) {
      if (placed.has(o)) errors.push(`${o} is in both ${placed.get(o)} and ${name}.`);
      else placed.set(o, name);
    }
    sites.push({ name, objects });
  }
  const missing = used.filter((o) => !placed.has(o));
  if (missing.length > 0) {
    errors.push(`Not placed in any database: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to a line like "DB1: ${missing.join(', ')}".`);
  }
  return { sites: sites.filter((x) => x.objects.length > 0), errors };
}

// ======================================================== local schedules

export interface Local {
  site: Site;
  /** This database's share: its objects' operations, plus the commits and aborts of transactions that ran here. */
  schedule: Schedule;
  css: CssResult;
  s2pl: Verdict;
}

function localSchedule(s: Schedule, site: Site): Schedule {
  const here = (o: Op) => o.obj !== null && site.objects.includes(o.obj);
  const txns = s.txns.filter((t) => s.ops.some((o) => o.txn === t && here(o)));
  return {
    ops: s.ops.filter((o) => here(o) || (o.obj === null && txns.includes(o.txn))),
    txns,
    objects: s.objects.filter((o) => site.objects.includes(o)),
    status: s.status,
  };
}

// ================================================================ checks

export interface DistributedAnalysis {
  locals: Local[];
  siteOf: Map<string, string>;
  /** The global precedence graph: the union of every database's. */
  global: CssResult;
  localCss: Verdict;
  allS2pl: Verdict;
  snapshots: Verdict;
  fcw: Verdict;
  reads: SnapshotRow[];
}

function tagged(edges: Edge[], site: string): Edge[] {
  return edges.map((e) => ({ ...e, reasons: e.reasons.map((r) => `${r} at ${site}`) }));
}

/** The global precedence graph, every edge tagged with the database its conflict happens at. */
function globalGraph(s: Schedule, locals: Local[]): CssResult {
  const whole = checkCss(s);
  const edges: Edge[] = [];
  for (const l of locals) for (const e of tagged(l.css.graph.edges, l.site.name)) addEdge(edges, e);
  const graph: Graph = { nodes: whole.graph.nodes, edges };
  const cycle = findCycle(graph);
  const order = cycle ? null : topoOrder(graph);
  const allLocal = locals.every((l) => l.css.holds);
  const orders = locals
    .filter((l) => l.css.order && l.css.order.length > 1)
    .map((l) => `${l.site.name}: ${orderText(l.css.order!)}`);
  return {
    graph,
    cycle,
    order,
    holds: cycle === null,
    summary: cycle
      ? allLocal
        ? `Every database is serializable on its own (${orders.join('; ')}), but the global graph has a cycle: ${cycleText(cycle)}. No single order works everywhere.`
        : `The global graph has a cycle: ${cycleText(cycle)}.`
      : `Acyclic, so the whole schedule is conflict-equivalent to ${orderText(order!)}.`,
    violations: cycle
      ? [
          {
            text: `Cycle ${cycleText(cycle)}.`,
            ops: edges.filter((e) => cycleArcs(cycle).has(`${e.from}>${e.to}`)).flatMap((e) => e.ops),
          },
        ]
      : [],
  };
}

export interface SnapshotRow {
  read: Op;
  site: string;
  /** Where the reading transaction starts at this database, and globally. */
  localStart: number;
  globalStart: number;
  /** The version a snapshot taken at each of those points gives the read. */
  local: number;
  global: number;
}

/**
 * Snapshot isolation run separately at each database: a transaction's
 * snapshot at a database is taken at its first operation there. Each read's
 * version under that, next to a single global snapshot taken at its first
 * operation anywhere.
 */
function snapshotRows(s: Schedule, siteOf: Map<string, string>): SnapshotRow[] {
  const firstAt = (t: number, site: string) =>
    s.ops.find((o) => o.txn === t && o.obj !== null && siteOf.get(o.obj) === site)!.index;
  const life = lifetimes(s);
  return s.ops
    .filter((o) => o.kind === 'R')
    .map((read) => {
      const site = siteOf.get(read.obj!)!;
      const localStart = firstAt(read.txn, site);
      const globalStart = life.get(read.txn)!.start;
      return {
        read,
        site,
        localStart,
        globalStart,
        local: snapshotVersion(s, read, localStart, life),
        global: snapshotVersion(s, read, globalStart, life),
      };
    });
}

/**
 * Consistent snapshots: for every pair of transactions, the reader's
 * snapshots at different databases agree on whether the writer has committed.
 * Per-database SI breaks this when a transaction starts at one database
 * before another transaction commits and at a second database after.
 */
function checkSnapshots(s: Schedule, rows: SnapshotRow[]): Verdict {
  const life = lifetimes(s);
  const violations: Violation[] = [];
  for (const ti of s.txns) {
    const mine = rows.filter((r) => r.read.txn === ti);
    for (const tj of s.txns) {
      if (tj === ti) continue;
      const cj = life.get(tj)!.commit;
      if (cj === null) continue;
      // Only reads of objects Tj writes can show whether Ti's snapshot includes Tj.
      const relevant = mine.filter((r) =>
        s.ops.some((o) => o.kind === 'W' && o.txn === tj && o.obj === r.read.obj && o.index < cj),
      );
      const sees = relevant.filter((r) => r.localStart > cj);
      const misses = relevant.filter((r) => r.localStart < cj);
      const sitesSee = [...new Set(sees.map((r) => r.site))];
      const sitesMiss = [...new Set(misses.map((r) => r.site))];
      if (sitesSee.length === 0 || sitesMiss.length === 0) continue;
      const a = sees[0];
      const b = misses[0];
      violations.push({
        text:
          `${T(ti)} sees ${T(tj)}'s commit at ${sitesSee.join(', ')} (it starts there at step ` +
          `${a.localStart + 1}, after C${tj} at step ${cj + 1}) but not at ${sitesMiss.join(', ')} ` +
          `(it starts there at step ${b.localStart + 1}, before). ${opText(a.read)} and ` +
          `${opText(b.read)} come from snapshots that no single moment matches.`,
        ops: [a.read.index, b.read.index, cj, a.localStart, b.localStart],
      });
    }
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every transaction sees the same set of commits at every database it reads from.'
        : 'Some transaction sees a commit at one database but not at another.',
    violations,
  };
}

export function analyseDistributed(s: Schedule, sites: Site[]): DistributedAnalysis {
  const siteOf = new Map<string, string>();
  for (const site of sites) for (const o of site.objects) siteOf.set(o, site.name);
  const locals: Local[] = sites
    .map((site) => {
      const schedule = localSchedule(s, site);
      return { site, schedule, css: checkCss(schedule), s2pl: checkS2pl(s, schedule.ops) };
    })
    .filter((l) => l.schedule.ops.length > 0);

  const failing = locals.filter((l) => !l.css.holds);
  const blocked = locals.filter((l) => !l.s2pl.holds);
  const rows = snapshotRows(s, siteOf);

  return {
    locals,
    siteOf,
    global: globalGraph(s, locals),
    localCss: {
      holds: failing.length === 0,
      summary:
        failing.length === 0
          ? 'Each database’s local schedule is conflict serializable on its own.'
          : `${failing.map((l) => l.site.name).join(', ')} ${failing.length === 1 ? 'is' : 'are'} not conflict serializable even on its own.`,
      violations: failing.flatMap((l) =>
        l.css.violations.map((v) => ({ ...v, text: `${l.site.name}: ${v.text}` })),
      ),
    },
    allS2pl: {
      holds: blocked.length === 0,
      summary:
        blocked.length === 0
          ? 'Every database could have run its share under strict 2PL.'
          : `Strict 2PL would block at ${blocked.map((l) => l.site.name).join(', ')}.`,
      violations: blocked.flatMap((l) =>
        l.s2pl.violations.map((v) => ({ ...v, text: `${l.site.name}: ${v.text}` })),
      ),
    },
    snapshots: checkSnapshots(s, rows),
    fcw: checkFirstCommitterWins(s),
    reads: rows,
  };
}

export function versionText(t: number, obj: string): string {
  return t === T0 ? `initial ${obj}` : `${T(t)}'s ${obj}`;
}

/** What a plain read actually saw in the schedule, for comparison with the snapshots. */
export function seenText(s: Schedule, read: Op): string {
  return versionText(seenVersion(s, read), read.obj!);
}
