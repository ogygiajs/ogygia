import type { HookEntry } from '@ogygia/insights';

/** What the realm the app's build compiled lends a reader that was not built with the app (the
 *  testing engine a test injects): whether the build is the dev server's, its regions' names, and
 *  the runtime's own lookups whose state lives in the runtime's module. */
export interface RealmFacts {
	readonly dev: boolean;
	names(): Promise<Record<string, string> | undefined>;
	props_sidecar_of(region: Element): HTMLScriptElement | null;
}

export interface HookRecord {
	readonly entries: HookEntry[];
	readonly listeners: Set<(e: HookEntry) => void>;
	realm?: RealmFacts;
}
