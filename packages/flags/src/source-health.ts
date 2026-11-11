/**
 * Whether the flag source is failing: a failure is said (`flags_source_failed`) once per failing
 * streak (`say()`), and the streak ends with a request the source served with no failure, like the
 * exposure sink's. `openfeature()` says a failure of one flag here while it still answers the others.
 */
import { say } from '@ogygia/machine';
import { warn } from './messages.ts';

/** The source's one streak. */
const STREAK = 'source';
const streak = say({ max: 1 });
let failures = 0;

/** A failure of the source (all of it, or one flag): said unless its streak was already said. */
export function source_failed(error: unknown): void {
	failures++;
	streak.once(STREAK, () => warn('flags_source_failed', error));
}

/** Before a call of the source: what `source_answered` compares against. */
export function source_mark(): number {
	return failures;
}

/** The source answered: with no failure since `mark`, its streak ends. */
export function source_answered(mark: number): void {
	if (failures === mark) streak.ok(STREAK);
}

/** A new source: no streak. */
export function source_reset(): void {
	streak.ok(STREAK);
}
