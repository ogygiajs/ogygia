// The region grid's browser legs: one case created fresh in the browser, and one case hydrated over
// its own server HTML. Each runs alone, so what reached the console is that case's, and settles
// before it is read (a late component, a promise, an effect).
import { flushSync, hydrate, mount, setContext, unmount, type Component } from 'svelte';
import RegionUnder from '../_fixtures/RegionUnder.svelte';
import { setNested } from '../../src/nested.ts';
import { setInLake, setInLiveSnippet } from '../../src/context.ts';
import { hole_slot_sequence, HOLE_SLOT_SEQUENCE } from '../../src/region-snippet.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { AT, CSR, ENV, product, props_for, type GridCase, type Place } from '../_region-grid.ts';

type Props = Record<string, unknown>;
export type ClientPlace = Pick<Place, 'at' | 'csr' | 'env'>;

/** Every place a region is created in the browser: where in the page, on which document, dev or
 *  production. (The render root and an error page are the server's: the browser reads neither.) */
export const CLIENT_PLACES: readonly ClientPlace[] = product({
	at: AT,
	csr: CSR,
	env: ENV
}) as ClientPlace[];

export const client_place_name = (p: ClientPlace): string => `at=${p.at} csr=${p.csr} env=${p.env}`;

/** The places a browser HYDRATES a region over the server's HTML: Kit's hydration of a csr=true
 *  document (a page and an error page), an island's hydration of what is nested in it (on either
 *  document), a live snippet's body, and a woken hole's answer. Each with the server place that
 *  rendered it. */
export const HYDRATE_PLACES: ReadonlyArray<{ client: ClientPlace; server: Place }> = ENV.flatMap(
	(env) =>
		(
			[
				['page', 'on', 'pass', 'ok'],
				['page', 'on', 'pass', 'error'],
				['island', 'off', 'pass', 'ok'],
				['island', 'on', 'pass', 'ok'],
				['live-snippet', 'off', 'pass', 'ok'],
				['live-snippet', 'on', 'pass', 'ok'],
				['woken-answer', 'off', 'ogygia', 'ok'],
				['woken-answer', 'on', 'ogygia', 'ok']
			] as const
		).map(([at, csr, kit, page]) => ({
			client: { at, csr, env },
			server: { at, csr, kit, page, env }
		}))
);

/** What the regions above a case set in context, in the browser. */
export function client_setup(place: ClientPlace): () => void {
	return () => {
		if (place.at === 'island') setNested(true, () => 'load');
		if (place.at === 'live-snippet') {
			setNested(true, () => 'load');
			setInLiveSnippet(true);
		}
		if (place.at === 'lake') {
			setNested(false);
			setInLake();
		}
		if (place.at === 'answer' || place.at === 'woken-answer')
			setContext(HOLE_SLOT_SEQUENCE, hole_slot_sequence('abcdef0123'));
		if (place.at === 'woken-answer') setNested(true);
	};
}

/** Each `applyLive` a region element was handed, by element. */
export const lived = new WeakMap<Element, unknown[]>();
export function define_region_element(): void {
	if (!customElements.get('ogygia-region'))
		customElements.define(
			'ogygia-region',
			class extends HTMLElement {
				applyLive(v: unknown) {
					const calls = lived.get(this) ?? [];
					calls.push(v);
					lived.set(this, calls);
				}
			}
		);
}

/** Microtask turns, then a flush: a late component's import, a promise, the effects they wake. */
async function settle(): Promise<void> {
	for (let i = 0; i < 12; i++) await Promise.resolve();
	flushSync();
	for (let i = 0; i < 12; i++) await Promise.resolve();
	flushSync();
}

/** `text` with Svelte's component stack (the `in <Name>` lines under a message) indented one way:
 *  one engine writes a tab, another spaces, and the three engines share one file. */
const one_stack = (text: string) => text.replace(/\n[\t ]+in /g, '\n  in ');

/**
 * `fn`, with what reached the console kept, and each rejection nobody handled (a held promise that
 * fails with no boundary hands the page its error that way: test/browser/_held-promise-fails.ts).
 * With `task`, it also waits a task after `fn`: the browser reports an unhandled rejection then.
 */
async function with_console<T>(
	fn: () => Promise<T>,
	task: boolean
): Promise<{ value: T; said: string[]; unhandled: string[] }> {
	const said: string[] = [];
	const unhandled: string[] = [];
	const { warn, error } = console;
	// (one engine's test runner also logs the rejection event itself: `unhandled` holds it already)
	const keep = (...a: unknown[]) => {
		if (a[0] instanceof PromiseRejectionEvent) return;
		said.push(one_stack(a.map(String).join(' ')));
	};
	// (taken first, and taken away: the test runner's own listener would report it as the test's error)
	const rejected = (e: PromiseRejectionEvent) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		unhandled.push(one_stack(String(e.reason)));
	};
	console.warn = keep;
	console.error = keep;
	window.addEventListener('unhandledrejection', rejected, { capture: true });
	try {
		const value = await fn();
		if (task) await new Promise((r) => setTimeout(r, 0));
		return { value, said, unhandled };
	} finally {
		console.warn = warn;
		console.error = error;
		window.removeEventListener('unhandledrejection', rejected, { capture: true });
	}
}

/** `text` with the browser's slot ids numbered from 1 by first appearance: off a request, an id is
 *  the page's running count (`og<n>`, region-snippet.ts `next_slot_id`), so its number says how many
 *  regions came before in this file, not anything of the case. */
function number_slots(text: string): string {
	const seen = new Map<string, number>();
	return text.replace(/slot:og([0-9a-z]+)(?![0-9a-z-])/g, (_all, n: string) => {
		if (!seen.has(n)) seen.set(n, seen.size + 1);
		return `slot:og#${seen.get(n)}`;
	});
}

/** A browser leg's output (its JSON), part by part: each key's value, as text. */
export function parts_of(out: string): Record<string, string> {
	return Object.fromEntries(
		Object.entries(JSON.parse(out) as Record<string, unknown>).map(([k, v]) => [
			k,
			typeof v === 'string' ? v : JSON.stringify(v, null, 1)
		])
	);
}

const live_of = (root: Element) =>
	[...root.querySelectorAll('ogygia-region')].flatMap((el) => lived.get(el) ?? []);

/** One case created fresh in the browser: the body it renders, the head it leaves, each value it
 *  handed a live element, and what it said. */
export async function client_out(c: GridCase, place: ClientPlace): Promise<string> {
	const target = document.body.appendChild(document.createElement('div'));
	const head_elements = () => [...document.head.children].map((el) => el.outerHTML).join('');
	const head_before = head_elements();
	runtime_session.kit_page = place.csr === 'on' ? true : undefined;
	try {
		const { value, said, unhandled } = await with_console(async () => {
			let app: Record<string, unknown> | null = null;
			let thrown: string | null = null;
			try {
				app = mount(RegionUnder as unknown as Component<Props>, {
					target,
					props: { setup: client_setup(place), regions: [props_for(c)] }
				});
				flushSync();
				await settle();
			} catch (e) {
				thrown = one_stack(`${(e as Error).name}: ${(e as Error).message}`);
			}
			const body = target.innerHTML;
			const live = live_of(target);
			const head_changed = head_elements() !== head_before;
			if (app) await unmount(app);
			return { body, live, head_changed, thrown };
		}, c.kind === 'promise');
		return number_slots(JSON.stringify({ ...value, said, unhandled }));
	} finally {
		target.remove();
		runtime_session.kit_page = undefined;
	}
}

/** One case hydrated over the server's `head` and `body`: whether the server's nodes stayed, the DOM
 *  after, each value handed a live element, and what Svelte (and Region) said. */
export async function hydrate_out(
	c: GridCase,
	place: ClientPlace,
	server: { head: string; body: string },
	make: () => Props = () => props_for(c)
): Promise<{ text: string; problems: string[] }> {
	// (parsed in a template, so its scripts stay inert as a parsed page's already-run ones are: the
	// runtime's own script tag must not load here)
	const template = document.createElement('template');
	template.innerHTML = server.head;
	const head_nodes = template.content;
	const server_head = [...head_nodes.childNodes];
	document.head.prepend(head_nodes);
	const target = document.body.appendChild(document.createElement('div'));
	target.innerHTML = server.body;
	const server_nodes = [...target.querySelectorAll('*')];
	runtime_session.kit_page = place.csr === 'on' ? true : undefined;
	try {
		const { value, said, unhandled } = await with_console(async () => {
			let app: Record<string, unknown> | null = null;
			let thrown: string | null = null;
			try {
				app = hydrate(RegionUnder as unknown as Component<Props>, {
					target,
					props: { setup: client_setup(place), regions: [make()] }
				});
				flushSync();
			} catch (e) {
				thrown = one_stack(`${(e as Error).name}: ${(e as Error).message}`);
			}
			const hydrated = {
				kept_body: server_nodes.every((n) => target.contains(n)),
				head_gone: server_head
					.filter((n) => !document.head.contains(n))
					.map((n) => (n as Element).outerHTML ?? `<!--${n.textContent}-->`),
				body_hydrated: target.innerHTML
			};
			if (app) await settle();
			const out = {
				...hydrated,
				body_after: target.innerHTML,
				live: live_of(target),
				thrown
			};
			if (app) await unmount(app);
			return out;
		}, c.kind === 'promise');
		const problems: string[] = [];
		if (value.thrown) problems.push(`threw ${value.thrown}`);
		if (!value.kept_body) problems.push('the server body was not kept');
		// (Svelte's head hydration takes its own opening hash comment away: only an element lost is a discard)
		const lost = value.head_gone.filter((n) => !n.startsWith('<!--'));
		if (lost.length) problems.push(`the server head lost ${lost.join('')}`);
		for (const s of said) if (/hydrat/i.test(s)) problems.push(`said ${s}`);
		return { text: number_slots(JSON.stringify({ ...value, said, unhandled })), problems };
	} finally {
		target.remove();
		for (const n of server_head) (n as ChildNode).remove();
		runtime_session.kit_page = undefined;
	}
}
