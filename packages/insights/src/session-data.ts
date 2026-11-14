/**
 * What a recorded session holds (the recorder: devtools/session.ts; what it says:
 * session-insights.ts). Types only, so the analysis reads them without the recorder.
 */
import type { RuntimeHookName, RuntimeHooks } from '@ogygia/core/plugin/client';

type HookPayload<K extends RuntimeHookName> = Parameters<RuntimeHooks[K]>[0];

/** One runtime hook call as the readers keep it: which hook, when it was called (`at`, page time,
 *  ms), its payload without the server markup, and the region its element names (`fp`, `entry`,
 *  `endpoint`): the element is held weakly and a saved session part drops it, so the names carry
 *  the region past the page. */
export type HookEntry = {
	[K in RuntimeHookName]: {
		readonly hook: K;
		readonly at: number;
		readonly fp?: string;
		readonly entry?: string;
		readonly endpoint?: string;
		/** held weakly (a region the page left can go); gone in a saved part */
		readonly el?: WeakRef<Element>;
	} & Omit<HookPayload<K>, 'el' | 'ssrHtml'>;
}[RuntimeHookName];

export interface SessionInteraction {
	t: number;
	name: string;
	duration: number;
	input_delay: number;
	processing: number;
	presentation: number;
	id: number;
	target: string;
	fp: string | null;
	el: WeakRef<Element> | null;
}
export interface SessionClick {
	t: number;
	target: string;
	fp: string | null;
	el: WeakRef<Element> | null;
	/** it looked like it does something (a control, a link, a clickable role, a pointer cursor): a
	 *  click on text or a blank stretch that changes nothing is no dead click */
	clickable?: true;
}
export interface SessionShift {
	t: number;
	value: number;
	input: boolean;
	fp: string | null;
	el: WeakRef<Element> | null;
}
export interface SessionRequest {
	url: string;
	type: string;
	t: number;
	ms: number;
	bytes: number;
	status: number | null;
	/** the server's own account (`Server-Timing`: ogygia's profiler sends ssr / cpu / net / up1-3) */
	server?: { name: string; ms: number; desc: string }[];
}
export interface SessionFrame {
	t: number;
	ms: number;
	blocking: number;
	scripts: { source: string; fn: string; invoker: string; ms: number }[];
}
/** A navigation as it started: where to, when, and the element that started it (the link or form, or
 *  the input being handled then) with its island. */
export interface SessionNav {
	url: string;
	t: number;
	type: string;
	source: string | null;
	fp: string | null;
}

export interface SessionData {
	from: number;
	to: number;
	interactions: SessionInteraction[];
	longtasks: { t: number; ms: number }[];
	frames: SessionFrame[];
	shifts: SessionShift[];
	requests: SessionRequest[];
	mutations: { fp: string | null; count: number; el: WeakRef<Element> | null }[];
	/** when the DOM changed, and where (one stamp per island per batch of changes) */
	mut_log: { t: number; fp: string | null }[];
	/** every click, fast ones too */
	clicks: SessionClick[];
	errors: { t: number; message: string }[];
	/** navigations as they started, with what started them (absent in a part saved before this field) */
	navs?: SessionNav[];
	heap: { from: number; to: number } | null;
	/** the runtime hooks the page called while it recorded */
	hooks: HookEntry[];
	cpu: unknown;
	cpu_off: string | null;
	page: string;
	/** the documents the session crossed (a full page load mid-session), each with when it began */
	pages: { url: string; t: number }[];
	/** island fingerprint → component name, taken on each page (its islands are gone after it) */
	names: Record<string, string>;
}
