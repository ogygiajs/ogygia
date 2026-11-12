// THE DIFFERENTIAL'S EYES: what ogygia observably does, read the same way in the simulator's fake
// browser (happy-dom) and in a real one (the player, ./sim-replay.ts), so the two can be compared
// action by action (internal/sim/src/differ.ts; internal/notes/dst.md "The differential"). A
// difference is a gap in the fake browser (fixed in the simulator) or a bug the fake browser hid.
//
// `ear` and `snapshot` run INSIDE a page: no imports, no closures over this module, as Playwright
// sends a function's source to the page. The simulator calls them on its window directly.

/** What one tab showed after an action. */
export interface TabSeen {
	readonly url: string;
	/** The document, normalized (./sim-observe.ts `snapshot`). */
	readonly dom: string;
	/** Machine moves of the shown document, one line each (`__ogygia_moves()`, rules builds). */
	readonly moves: string;
	/** What the tab's documents heard since the last look, in order (`ear`): `<type> <readyState>
	 *  <target>`, each line after a document's first `@doc <n>` line. */
	readonly heard: readonly string[];
	/** Errors since the last look: uncaught errors and console errors, first line each. */
	readonly said: readonly string[];
}

/** What the visitor saw after one action (or the first load). */
export interface Seen {
	/** `first load`, or the action's index (from 1) and kind. */
	readonly after: string;
	readonly tabs: readonly TabSeen[];
	/** Requests the tabs made to the app's origin since the last look: `<tab> <METHOD> <path>`. */
	readonly requests: readonly string[];
}

/** One run as the differential reads it: a plan the player can play (app, seed, actions), and what
 *  the simulator or a browser saw. */
export interface Observed {
	readonly app: string;
	readonly seed: number;
	readonly gen?: number;
	readonly plan: { readonly actions: readonly unknown[] };
	/** `sim`, or the browser's name. */
	readonly by: string;
	readonly seen: readonly Seen[];
}

/** Action kinds a calm run leaves out on both sides: what the two worlds cannot do alike (a
 *  deploy: the player has one server; offline: the simulator's is one tab's, a browser's every
 *  tab's). */
export const NOT_CALM: readonly string[] = ['deploy', 'offline', 'online', 'outage'];

/** The plan's actions a calm run plays. */
export function calm_actions<A extends { kind: string }>(actions: readonly A[]): A[] {
	return actions.filter((a) => !NOT_CALM.includes(a.kind));
}

/**
 * Listens, from before the document's first script, for the events that tell its lifecycle and
 * ogygia's: each heard one goes to `globalThis.__sim_heard(line)` as it happens (so a document left
 * mid-action still told what it heard). Capturing on the window: a page cannot stop it first.
 */
export function ear(on?: object): void {
	const w = (on ?? globalThis) as unknown as {
		__sim_heard?: (line: string) => void;
		addEventListener(type: string, fn: (e: Event) => void, capture: boolean): void;
		document: Document;
		location: Location;
	};
	const location = w.location;
	const TYPES = [
		'readystatechange',
		'DOMContentLoaded',
		'load',
		'pageshow',
		'pagehide',
		'popstate',
		'hashchange',
		'og:before-swap',
		'og:after-swap',
		'og:page-load',
		'ogygia:boot',
		'ogygia:hydrated',
		'ogygia:live',
		'ogygia:region'
	];
	const doc = w.document;
	w.__sim_heard?.(`@doc ${location.pathname}${location.search}`);
	const target = (t: EventTarget | null): string => {
		if (t === doc) return 'document';
		if (t === null || !('tagName' in t)) return 'window';
		const el = t as Element;
		const entry = el.getAttribute('entry');
		return `<${el.tagName.toLowerCase()}${entry ? ` ${entry.replace(/[?#].*/, '')}` : ''}>`;
	};
	for (const type of TYPES)
		// oxlint-disable-next-line ogygia/owned-effects -- runs in the observed page (an init script, no imports): the document's record for its whole life
		w.addEventListener(
			type,
			(e) => w.__sim_heard?.(`${type} ${doc.readyState} ${target(e.target)}`),
			true
		);
}

/**
 * The document as a list of lines, for a diff: elements with their attributes sorted, text
 * collapsed, no scripts, comments or preload links (a fetch hint, not content), times and random
 * numbers masked. The head's children sorted (an answer lifts its sheets into it in network order).
 * Like the MPA oracle's `normalize` (internal/sim/src/oracles.ts), which a page cannot run.
 */
export function snapshot(doc: Document): string {
	const mask = (s: string): string =>
		s
			.replace(/\s+/g, ' ')
			.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, '<time>')
			.replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?: ?[AP]M)?(?:\.\d+)?/g, '<time>')
			.replace(/\b0\.\d{8,}\b/g, '<random>')
			.trim();
	const walk = (node: Node, depth: number, out: string[]): void => {
		if (node.nodeType === 3) {
			const t = mask(node.textContent ?? '');
			if (t !== '') out.push(`${'  '.repeat(depth)}"${t}"`);
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node as Element;
		const tag = el.tagName.toLowerCase();
		if (tag === 'script' || tag === 'noscript') return;
		if (tag === 'link' && /\b(modulepreload|preload|prefetch)\b/.test(el.getAttribute('rel') ?? ''))
			return;
		// oxlint-disable-next-line ogygia/markup-from-vocabulary -- runs in the page, which has no imports: core's OGYGIA_ANNOUNCER (wire-markup.ts), spelled again
		if (el.hasAttribute('data-ogygia-announcer')) return;
		const attrs = [...el.attributes]
			// (an empty `style` is what a browser leaves once a script set and cleared a property)
			.filter(
				(a) =>
					a.name !== 'nonce' &&
					!a.name.startsWith('data-sim-') &&
					!(a.name === 'style' && a.value.trim() === '')
			)
			.map((a) => {
				const v = /^(href|src|action)$/.test(a.name)
					? new URL(a.value, doc.baseURI).pathname
					: mask(a.value);
				return `${a.name}="${v}"`;
			})
			.sort()
			.join(' ');
		out.push(`${'  '.repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ''}>`);
		const kids: string[][] = [];
		for (const child of el.childNodes) {
			const one: string[] = [];
			walk(child, depth + 1, one);
			if (one.length > 0) kids.push(one);
		}
		if (tag === 'head') kids.sort((a, b) => (a.join('\n') < b.join('\n') ? -1 : 1));
		for (const k of kids) out.push(...k);
	};
	const out = [`title: ${mask(doc.title)}`];
	if (doc.documentElement) walk(doc.documentElement, 0, out);
	return out.join('\n');
}
