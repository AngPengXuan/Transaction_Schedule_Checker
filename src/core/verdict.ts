/** What every check returns: whether the property holds, why, and the operations to blame. */

export interface Violation {
  text: string;
  /** Indexes into the full schedule, lit up in the schedule grid on hover. */
  ops: number[];
}

export interface Verdict {
  holds: boolean;
  summary: string;
  violations: Violation[];
}

/**
 * For a chain of properties ordered strongest first, the nearest stronger one
 * than position `at` that holds -- which already guarantees the one at `at`.
 */
export function strongerHolding(
  chain: { short: string; holds: boolean }[],
  at: number,
): string | undefined {
  for (let i = at - 1; i >= 0; i--) if (chain[i].holds) return chain[i].short;
  return undefined;
}
