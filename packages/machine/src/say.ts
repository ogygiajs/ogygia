/**
 * say(): EDGE-TRIGGERED REPORTING. A thing worth telling is told when it starts (the edge), not
 * every time it is still true (the level). One reporter answers the three ways a "say it once"
 * guard was written by hand:
 *
 * - once ever: one constant key (`said.once('no-key', …)`);
 * - once per key: the key names what "the same thing" is (`said.once(url, …)`);
 * - once per failing streak: say the failure with `once`, and `ok` the key when it works again, so
 *   the next failure is a new streak and is said again.
 *
 *   const sink = say();
 *   sink.once('exposures', () => warn('flags_exposure_failed', error));   // a failure
 *   sink.ok('exposures');                                                  // it worked again
 *
 * The keys it remembers are bounded (`max`, 1024 by default; the least recently said go first), so a
 * key made from a URL or an id never grows a long-lived server. A key let go for the bound is said
 * again when it comes back. (The bound is a small LRU of its own; it moves onto `cache()` once that
 * lands, #416.)
 */
import { machine_error } from './messages.ts';

/** How many keys a reporter remembers by default. */
const DEFAULT_MAX = 1024;

/** An edge-triggered reporter: see {@link say}. */
export interface Say {
	/** Says it (`speak()`), unless `key` was said and has not recovered since. True when it spoke. */
	once(key: string, speak: () => void): boolean;
	/** `key` recovered (its streak ended): the next `once(key)` says it again. */
	ok(key: string): void;
	/** How many keys it remembers now (never more than its `max`). */
	readonly size: number;
}

/** Options for {@link say}. */
export interface SayOptions {
	/** The most keys it remembers; past it, the least recently said is let go. Default 1024. */
	max?: number;
}

/**
 * An edge-triggered reporter: each key is said once, until it recovers (`ok`), and at most `max`
 * keys are remembered.
 */
export function say(options: SayOptions = {}): Say {
	const max = options.max ?? DEFAULT_MAX;
	if (!Number.isInteger(max) || max < 1)
		throw machine_error('machine_bad_option', {
			option: 'max',
			value: String(max),
			rule: 'a whole number of keys, 1 or more'
		});
	// (a Map keeps insertion order: the first key is the least recently said)
	const said = new Map<string, true>();
	return {
		once(key, speak) {
			if (said.has(key)) {
				said.delete(key);
				said.set(key, true);
				return false;
			}
			if (said.size >= max) said.delete(said.keys().next().value!);
			said.set(key, true);
			speak();
			return true;
		},
		ok(key) {
			said.delete(key);
		},
		get size() {
			return said.size;
		}
	};
}
