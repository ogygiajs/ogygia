import type { HookEntry } from '@ogygia/insights';

/** What the realm lends on first ask, from a chunk of its own (no boot bytes): the build's regions'
 *  names, and the runtime's sidecar lookup, whose state lives in the runtime's module. */
export interface RealmLoan {
	readonly region_names: Record<string, string> | undefined;
	props_sidecar_of(region: Element): HTMLScriptElement | null;
}

/** What the realm the app's build compiled tells a reader that was not built with the app (the
 *  testing engine a test injects). */
export interface RealmFacts {
	readonly dev: boolean;
	lend(): Promise<RealmLoan>;
}

export interface HookRecord {
	readonly entries: HookEntry[];
	readonly listeners: Set<(e: HookEntry) => void>;
	realm?: RealmFacts;
}
