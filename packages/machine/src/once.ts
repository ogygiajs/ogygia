/**
 * Load something once, and keep it: but never keep a failure.
 *
 *   const core = once(() => import('./hydrate-core.ts'), { retries: 2 });
 *   const { hydrate } = await core();
 *
 * idle → loading → ready, or failed → loading again on the next call. Callers while it loads share
 * the one load. A load that fails (after its retries) rejects every caller of that load, and the
 * next call starts a fresh one: one network blip does not break it for the rest of the page.
 */
import { machine_error } from './messages.ts';

export interface OnceOptions {
	/** Tries again at once this many times before a load fails. Default 0. */
	retries?: number;
}

async function attempt<T>(load: () => T | PromiseLike<T>, retries: number): Promise<Awaited<T>> {
	for (let left = retries; ; left--) {
		try {
			return await load();
		} catch (error) {
			if (left <= 0) throw error;
		}
	}
}

/** `load`, run on the first call and kept once it succeeds (see the module's comment). */
export function once<T>(
	load: () => T | PromiseLike<T>,
	options?: OnceOptions
): () => Promise<Awaited<T>> {
	const retries = options?.retries ?? 0;
	if (!Number.isInteger(retries) || retries < 0)
		throw machine_error('machine_bad_option', { option: 'retries', value: String(retries) });
	let current: Promise<Awaited<T>> | null = null;
	return () => {
		if (current !== null) return current;
		const loading = attempt(load, retries);
		current = loading;
		loading.then(undefined, () => {
			if (current === loading) current = null;
		});
		return loading;
	};
}
