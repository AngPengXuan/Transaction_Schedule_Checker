/**
 * Schedules: parsing the usual R1(A) W2(A) C1 A2 notation (plus, on the MVCC
 * page, versioned reads R1,2(A)), and the two views of a schedule the checks
 * run on -- the full schedule (recoverability cares about aborts) and its
 * committed projection (serializability does not).
 */

export type OpKind = 'R' | 'W' | 'C' | 'A';

export interface Op {
  /** Position in the full schedule, 0-based. Every highlight refers to ops by this. */
  index: number;
  kind: OpKind;
  txn: number;
  obj: string | null;
  /**
   * Multiversion reads only: the transaction whose version of `obj` this read
   * sees, T0 for the initial version. Undefined for every other operation,
   * and for a read that just sees the latest earlier write.
   */
  version?: number;
}

export type TxnStatus = 'committed' | 'aborted' | 'active';

export interface Schedule {
  ops: Op[];
  /** Transaction ids in order of first appearance. */
  txns: number[];
  objects: string[];
  status: Record<number, TxnStatus>;
}

/** T0 is the virtual transaction that wrote every object's initial value. */
export const T0 = 0;

/**
 * Tf is the virtual transaction of the lecture's polygraph that reads every
 * written object after the schedule ends. Never a parsed id (those are >= 1).
 */
export const TF = -1;

export function isVirtual(t: number): boolean {
  return t === T0 || t === TF;
}

export function txnName(t: number): string {
  return t === TF ? 'Tf' : `T${t}`;
}

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/** Digits as subscripts: version 2 of A is shown A₂. */
export function subscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUBSCRIPTS[Number(d)])
    .join('');
}

/** "R1(A)", "C2", or for a versioned read "R1(A₂)" -- T1 reads T2's version of A. */
export function opText(op: Op): string {
  const who = op.txn === TF ? 'f' : String(op.txn);
  if (op.obj === null) return `${op.kind}${who}`;
  const version = op.version === undefined ? '' : subscript(op.version);
  return `${op.kind}${who}(${op.obj}${version})`;
}

/** The same operation in input notation, R1,2(A) for a versioned read. */
export function opInput(op: Op): string {
  if (op.obj === null) return `${op.kind}${op.txn}`;
  const version = op.version === undefined ? '' : `,${op.version}`;
  return `${op.kind}${op.txn}${version}(${op.obj})`;
}

// The comma of a versioned read R1,2(A) is joined up as "~" before the
// schedule is split on commas, so that it survives as one token.
const VERSIONED = /([RW]\s*\d+)\s*,\s*(\d+)\s*(?=[([])/gi;
const TOKEN = /^([RWCA])\s*(\d+)(?:~(\d+))?\s*(?:[([]\s*([A-Za-z_][A-Za-z0-9_]*)\s*[)\]])?$/i;

export interface ParseResult {
  schedule: Schedule | null;
  errors: string[];
}

export interface ParseOptions {
  /** Accept versioned reads R1,2(A). Only the MVCC page does. */
  versions?: boolean;
}

/**
 * Accepts R1(A), r1[a], W2(B), C1, A2 separated by spaces, commas or
 * semicolons. Objects are case-insensitive and shown upper-case. Rejects
 * anything a real schedule cannot contain: an operation after its
 * transaction's commit or abort, a second commit, or a T0 (reserved).
 *
 * With `versions`, a read may name the version it sees: R1,2(A) is T1 reading
 * T2's version of A, R1,0(A) the initial version. That version must exist at
 * the time of the read, and a transaction that has written A must read its own.
 */
export function parseSchedule(raw: string, options: ParseOptions = {}): ParseResult {
  const tokens = raw
    .replace(VERSIONED, '$1~$2')
    .replace(/\s*([([])\s*/g, '$1')
    .split(/[\s,;]+/)
    .filter((t) => t !== '');
  const errors: string[] = [];
  const ops: Op[] = [];
  const txns: number[] = [];
  const objects: string[] = [];
  const status: Record<number, TxnStatus> = {};

  for (const token of tokens) {
    const shown = token.replace('~', ',');
    const m = TOKEN.exec(token);
    if (!m) {
      errors.push(`"${shown}" is not an operation like R1(A), W2(B), C1 or A2.`);
      continue;
    }
    const kind = m[1].toUpperCase() as OpKind;
    const txn = Number(m[2]);
    const version = m[3] === undefined ? undefined : Number(m[3]);
    const obj = m[4] ? m[4].toUpperCase() : null;
    if (version !== undefined) {
      if (!options.versions) {
        errors.push(`"${shown}": versioned reads like R1,2(A) are for the MVCC page.`);
        continue;
      }
      if (kind !== 'R') {
        errors.push(`"${shown}": only a read names a version; a write always creates its own.`);
        continue;
      }
      const problem = versionProblem(ops, status, txn, obj!, version);
      if (problem) {
        errors.push(`"${shown}": ${problem}`);
        continue;
      }
    }
    if (txn === T0) {
      errors.push(`"${token}": T0 is reserved for the initial values. Number transactions from 1.`);
      continue;
    }
    if ((kind === 'R' || kind === 'W') && obj === null) {
      errors.push(`"${token}" needs an object, e.g. ${kind}${txn}(A).`);
      continue;
    }
    if ((kind === 'C' || kind === 'A') && obj !== null) {
      errors.push(`"${token}": commit and abort take no object — write ${kind}${txn}.`);
      continue;
    }
    if (status[txn] === 'committed' || status[txn] === 'aborted') {
      errors.push(`"${token}" comes after T${txn} already ${status[txn]}.`);
      continue;
    }
    if (!txns.includes(txn)) txns.push(txn);
    if (obj !== null && !objects.includes(obj)) objects.push(obj);
    status[txn] = kind === 'C' ? 'committed' : kind === 'A' ? 'aborted' : 'active';
    ops.push({ index: ops.length, kind, txn, obj, ...(version !== undefined ? { version } : {}) });
  }

  if (errors.length > 0) return { schedule: null, errors };
  if (ops.length === 0) return { schedule: null, errors: [] };
  return { schedule: { ops, txns, objects: objects.sort(), status }, errors };
}

/** Why T`txn` cannot read version `version` of `obj` at this point, or null if it can. */
function versionProblem(
  earlier: Op[],
  status: Record<number, TxnStatus>,
  txn: number,
  obj: string,
  version: number,
): string | null {
  const wrote = (t: number) => earlier.some((o) => o.kind === 'W' && o.txn === t && o.obj === obj);
  if (version !== txn && wrote(txn)) {
    return `T${txn} has already written ${obj}, so it must read its own version (R${txn},${txn}(${obj})).`;
  }
  if (version === T0) return null;
  if (!wrote(version)) {
    return version === txn
      ? `T${txn} has not written ${obj} yet, so it has no version of its own to read.`
      : `T${version} has not written ${obj} yet, so that version does not exist.`;
  }
  if (status[version] === 'aborted') {
    return `T${version} has aborted, so its version of ${obj} was discarded.`;
  }
  return null;
}

/**
 * The committed projection, used for CSS and VSS: aborted transactions'
 * operations are dropped, and transactions with no commit or abort are kept
 * as though they committed at the end. Indexes still refer to the full schedule.
 */
export function committedProjection(s: Schedule): { ops: Op[]; txns: number[] } {
  const keep = (t: number) => s.status[t] !== 'aborted';
  return {
    ops: s.ops.filter((op) => keep(op.txn) && (op.kind === 'R' || op.kind === 'W')),
    txns: s.txns.filter(keep),
  };
}

export function formatSchedule(s: Schedule): string {
  return s.ops.map(opText).join(' ');
}
