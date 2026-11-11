import { say } from '@ogygia/machine';
import { warn } from './messages.ts';

const STREAK = 'source';
const streak = say({ max: 1 });
let failures = 0;

/**
 * A failure of the source (all of it, or one flag, which `openfeature()` reports while it still
 * answers the others): `flags_source_failed` is said once per failing streak. The streak ends with a
 * request the source served with no failure (`source_answered`).
 */
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
