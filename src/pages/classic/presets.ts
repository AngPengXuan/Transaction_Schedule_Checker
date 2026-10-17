/**
 * One schedule for every region of the classic diagram: three serializability
 * columns × four recoverability rows (S1–S12), plus Serial, which sits inside
 * Strict ∩ CSS. Each lands in exactly its region, and the region map in the
 * sidebar loads them on click.
 */

export type SerialClass = 0 | 1 | 2 | 3; // not VSS, VSS only, CSS not serial, serial
export type RecoveryClass = 0 | 1 | 2 | 3; // not recoverable, recoverable only, ACA only, strict

export interface Preset {
  id: string;
  name: string;
  schedule: string;
  /** Where the schedule should land; absent for the extra examples. */
  region?: { ser: SerialClass; rec: RecoveryClass };
}

export const SER_LABELS = ['not VSS', 'VSS, not CSS', 'CSS, not serial', 'serial'];
export const REC_LABELS = ['not recoverable', 'recoverable, not ACA', 'ACA, not strict', 'strict'];

function region(ser: SerialClass, rec: RecoveryClass, n: number | null, special?: string): Omit<Preset, 'schedule'> {
  const id = n === null ? 'serial' : `S${n}`;
  const where = n === null ? 'Serial' : `${id} — ${SER_LABELS[ser]} · ${REC_LABELS[rec]}`;
  return { id, name: special ? `${where} (${special})` : where, region: { ser, rec } };
}

export const REGION_PRESETS: Preset[] = [
  { ...region(0, 0, 1), schedule: 'R2(B) W1(A) R2(A) W1(B) C2 C1' },
  { ...region(1, 0, 2), schedule: 'W2(A) R1(A) W3(A) W1(A) C1 C2 C3' },
  { ...region(2, 0, 3, 'dirty read, reader commits first'), schedule: 'W1(A) R2(A) W2(B) C2 C1' },
  { ...region(0, 1, 4), schedule: 'R2(B) W1(A) R2(A) W1(B) C1 C2' },
  { ...region(1, 1, 5), schedule: 'W2(A) R1(A) W3(A) W1(A) C2 C1 C3' },
  { ...region(2, 1, 6, 'dirty read, cascading abort risk'), schedule: 'W1(A) R2(A) W2(B) C1 C2' },
  { ...region(0, 2, 7, 'lost update'), schedule: 'R1(A) R2(A) W1(A) W2(A) C1 C2' },
  { ...region(1, 2, 8, 'blind writes, forced (c) edges'), schedule: 'R1(A) W2(A) W1(A) W3(A) C1 C2 C3' },
  { ...region(2, 2, 9, 'dirty write'), schedule: 'W1(A) W2(A) C1 C2' },
  { ...region(0, 3, 10, 'unrepeatable read'), schedule: 'R1(A) W2(A) C2 R1(A) C1' },
  { ...region(1, 3, 11, 'blind writes, all committed'), schedule: 'R1(A) W2(A) C2 W1(A) C1 W3(A) C3' },
  { ...region(2, 3, 12), schedule: 'W1(A) R2(B) C1 R2(A) C2' },
  { ...region(3, 3, null), schedule: 'R1(A) W1(A) C1 R2(A) W2(A) C2' },
];

export const EXTRA_PRESETS: Preset[] = [
  { id: 'choices', name: 'VSS with either/or choices (8 possible graphs)', schedule: 'W1(A) R2(A) W3(A) R4(A) W2(A) C1 C2 C3 C4' },
  { id: 'all-cyclic', name: 'Not VSS: every possible graph has a cycle', schedule: 'W1(A) R2(A) R3(A) W3(A) W2(A) C1 C2 C3' },
  { id: 'i-eq-k', name: 'Reads an overwritten value (rule c, i = k)', schedule: 'W1(X) R2(X) W1(X) C2 C1' },
  { id: 'i-eq-j', name: 'Reads after its own write (rule c, i = j)', schedule: 'W1(A) W2(A) R1(A) C1 C2' },
  { id: 'write-skew', name: 'Write skew', schedule: 'R1(A) R1(B) R2(A) R2(B) W1(A) W2(B) C1 C2' },
  { id: 'aborted-read', name: 'Reads from an aborted transaction', schedule: 'W1(A) R2(A) A1 W2(B) C2' },
];

export const ALL_PRESETS = [...REGION_PRESETS, ...EXTRA_PRESETS];

export const DEFAULT_PRESET = EXTRA_PRESETS[0];
