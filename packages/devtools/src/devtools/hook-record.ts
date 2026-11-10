import type { RuntimeHookName, RuntimeHooks } from '@ogygia/core/plugin/client';
import type { HookEntry } from '@ogygia/insights';

export type { HookEntry } from '@ogygia/insights';

const CAP = 4096;
// @why every bundle carrying a copy of this module (the boot's client realm, the dock's chunk, the testing engine) shares one record (test: devtools-hook-record)
const RECORD_KEY = Symbol.for('ogygia.hook-record');

interface HookRecord {
	readonly entries: HookEntry[];
	readonly listeners: Set<(e: HookEntry) => void>;
}

function state(): HookRecord {
	const g = globalThis as { [RECORD_KEY]?: HookRecord };
	return (g[RECORD_KEY] ??= { entries: [], listeners: new Set() });
}

export function record_hook<K extends RuntimeHookName>(
	hook: K,
	payload: Parameters<RuntimeHooks[K]>[0]
): void {
	const el = (payload as { el?: Element }).el;
	const fp = el?.getAttribute('data-og-fp');
	const entry = el?.getAttribute('entry');
	const endpoint = el?.getAttribute('endpoint');
	const e = {
		...(fp ? { fp } : {}),
		...(entry ? { entry } : {}),
		...(endpoint ? { endpoint } : {}),
		...payload,
		hook,
		at: performance.now()
	} as HookEntry;
	const r = state();
	r.entries.push(e);
	if (r.entries.length > CAP) r.entries.splice(0, r.entries.length - CAP);
	for (const f of r.listeners) f(e);
}

export function hook_entries(): readonly HookEntry[] {
	return state().entries;
}

export function on_hook(f: (e: HookEntry) => void): () => void {
	const r = state();
	r.listeners.add(f);
	return () => {
		r.listeners.delete(f);
	};
}
