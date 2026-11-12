import type { HookEntry } from '@ogygia/insights';
import type { HookRecord, RealmFacts } from './hook-record-type.ts';

export type { HookEntry } from '@ogygia/insights';

// @why the same global hook-record.ts writes (test: devtools-hook-record)
const RECORD_KEY = Symbol.for('ogygia.hook-record');

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

/** What the app's realm lent this page's readers; undefined until a realm boots, or with none. */
export function recorded_realm(): RealmFacts | undefined {
	return state().realm;
}

/** The app's build is the dev server's (false with no realm on the page). */
export function built_dev(): boolean {
	return state().realm?.dev === true;
}
