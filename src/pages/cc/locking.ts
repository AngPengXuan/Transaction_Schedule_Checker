/**
 * The concurrency-control page's locking checks: could 2PL or strict 2PL
 * have produced the schedule, and what happens when it is replayed through
 * a strict 2PL lock manager.
 */
import { check2pl } from '../../core/protocols/twopl';
import type { TwoPlResult } from '../../core/protocols/twopl';
import { checkS2pl } from '../../core/protocols/s2pl';
import type { Schedule } from '../../core/schedule';
import type { Verdict } from '../../core/verdict';
import { checkCss } from '../classic/analysis';
import type { CssResult } from '../classic/analysis';

export interface LockingAnalysis {
  strict: Verdict;
  twoPl: TwoPlResult;
  css: CssResult;
  /** False when some read sees an older version, which no single-version locking scheduler does. */
  applicable: boolean;
}

const NOT_APPLICABLE =
  'Not produced by locking: a locking scheduler keeps one version of each object, but here a read sees an older one.';

export function analyseLocking(s: Schedule, monoversion: boolean): LockingAnalysis {
  const css = checkCss(s);
  if (!monoversion) {
    const na: Verdict = { holds: false, summary: NOT_APPLICABLE, violations: [] };
    return {
      strict: na,
      twoPl: { ...na, plan: null, lockPoints: null },
      css: { ...css, holds: false, summary: 'Not a monoversion schedule, so conflicts are not defined the usual way.', violations: [] },
      applicable: false,
    };
  }
  const twoPl = check2pl(s);
  if (!twoPl.holds && !css.holds) {
    twoPl.summary = 'No: it is not even conflict serializable, and every 2PL schedule is.';
    twoPl.violations = css.violations;
  }
  return { strict: checkS2pl(s), twoPl, css, applicable: true };
}
