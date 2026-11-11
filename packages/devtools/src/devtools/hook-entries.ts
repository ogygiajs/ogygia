import type { HookEntry } from '@ogygia/insights';

export type { HookEntry } from '@ogygia/insights';

// @why the same global hook-record.ts writes (test: devtools-hook-record)
const RECORD_KEY = Symbol.for('ogygia.hook-record');

interface HookRecord {
	readonly entries: HookEntry[];
	readonly listeners: Set<(e: HookEntry) => void>;
}

function state(): HookRecord {
	const g = globalThis as { [RECORD_KEY]?: HookRecord };
	return (g[RECORD_KEY] ??= { entries: [], listeners: new Set() });
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
