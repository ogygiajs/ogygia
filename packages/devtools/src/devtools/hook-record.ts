import { OG_FP } from '@ogygia/core/internal/instruments';
import type { RuntimeHookName, RuntimeHooks } from '@ogygia/core/plugin/client';
import type { HookEntry } from '@ogygia/insights';
import type { HookRecord, RealmFacts } from './hook-record-type.ts';

const CAP = 4096;
// @why the boot's realm writes here and the dock's lazy readers read hook-entries.ts: one global, no module shared by both, so no extra boot chunk (test: devtools-hook-record)
const RECORD_KEY = Symbol.for('ogygia.hook-record');

function record(): HookRecord {
	const g = globalThis as { [RECORD_KEY]?: HookRecord };
	return (g[RECORD_KEY] ??= { entries: [], listeners: new Set() });
}

export function record_hook<K extends RuntimeHookName>(
	hook: K,
	payload: Parameters<RuntimeHooks[K]>[0]
): void {
	// @why the record outlives the regions an in-app navigation removes: it holds them weakly and keeps no server markup (test: devtools-hook-record › holds a region only weakly)
	const { el, ssrHtml: _markup, ...rest } = payload as { el?: Element; ssrHtml?: unknown };
	const fp = el?.getAttribute(OG_FP);
	const entry = el?.getAttribute('entry');
	const endpoint = el?.getAttribute('endpoint');
	const e = {
		...(fp ? { fp } : {}),
		...(entry ? { entry } : {}),
		...(endpoint ? { endpoint } : {}),
		...rest,
		...(el ? { el: new WeakRef(el) } : {}),
		hook,
		at: performance.now()
	} as HookEntry;
	const r = record();
	r.entries.push(e);
	if (r.entries.length > CAP) r.entries.splice(0, r.entries.length - CAP);
	for (const f of r.listeners) f(e);
}

export function record_realm(realm: RealmFacts): void {
	record().realm = realm;
}
