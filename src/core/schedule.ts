/**
 * Schedules: parsing the usual R1(A) W2(A) C1 A2 notation, and the two views
 * of a schedule the checks run on -- the full schedule (recoverability cares
 * about aborts) and its committed projection (serializability does not).
 */

export type OpKind = 'R' | 'W' | 'C' | 'A';

export interface Op {
  /** Position in the full schedule, 0-based. Every highlight refers to ops by this. */
  index: number;
  kind: OpKind;
  txn: number;
  obj: string | null;
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

export function opText(op: Op): string {
  const who = op.txn === TF ? 'f' : String(op.txn);
  return op.obj === null ? `${op.kind}${who}` : `${op.kind}${who}(${op.obj})`;
}

const TOKEN = /^([RWCA])\s*(\d+)\s*(?:[([]\s*([A-Za-z_][A-Za-z0-9_]*)\s*[)\]])?$/i;

export interface ParseResult {
  schedule: Schedule | null;
  errors: string[];
}

/**
 * Accepts R1(A), r1[a], W2(B), C1, A2 separated by spaces, commas or
 * semicolons. Objects are case-insensitive and shown upper-case. Rejects
 * anything a real schedule cannot contain: an operation after its
 * transaction's commit or abort, a second commit, or a T0 (reserved).
 */
export function parseSchedule(raw: string): ParseResult {
  const tokens = raw
    .replace(/\s*([([])\s*/g, '$1')
    .split(/[\s,;]+/)
    .filter((t) => t !== '');
  const errors: string[] = [];
  const ops: Op[] = [];
  const txns: number[] = [];
  const objects: string[] = [];
  const status: Record<number, TxnStatus> = {};

  for (const token of tokens) {
    const m = TOKEN.exec(token);
    if (!m) {
      errors.push(`"${token}" is not an operation like R1(A), W2(B), C1 or A2.`);
      continue;
    }
    const kind = m[1].toUpperCase() as OpKind;
    const txn = Number(m[2]);
    const obj = m[3] ? m[3].toUpperCase() : null;
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
    ops.push({ index: ops.length, kind, txn, obj });
  }

  if (errors.length > 0) return { schedule: null, errors };
  if (ops.length === 0) return { schedule: null, errors: [] };
  return { schedule: { ops, txns, objects: objects.sort(), status }, errors };
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
