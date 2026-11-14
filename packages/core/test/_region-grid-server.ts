// The region grid's server leg: one case rendered at one place, as one request renders it. The
// build's answers (deps, sheets, locations, endpoints) are stand-ins that name their inputs, so a
// change to what Region asks for shows in the output. No `vi` here: the hydration grid renders the
// same cases from a browser command, outside a test.
import './_region-grid-devtools.ts';
import { render } from 'svelte/server';
import { setContext, type Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import { set_server_devtools_recorder } from '../src/events/server-registry.ts';
import { set_page_recorder } from '../src/page-seed-registry.ts';
import { setInLake, setInLiveSnippet, take_early_holes } from '../src/context.ts';
import { setNested } from '../src/nested.ts';
import { set_building } from './_stubs/app-env.ts';
import { page } from './_stubs/app-state.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { csr_true_routes, error_csr_true_routes } from './_stubs/server.route-csr.ts';
import {
	KIT_REQUEST_CONTEXT,
	set_kit_event_reader,
	set_render_page_port
} from '../src/server/kit-context.ts';
import { hole_slot_sequence, HOLE_SLOT_SEQUENCE } from '../src/region-snippet.ts';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { SeedIndex } from '../src/seed-refs.ts';
import * as deps from './_stubs/server.region-deps.ts';
import { set_region_endpoints } from './_stubs/server.region-endpoint.ts';
import {
	PAGE_DATA,
	LIVE_ENTRY,
	props_for,
	request_for,
	type GridCase,
	type Place
} from './_region-grid.ts';

type Props = Record<string, unknown>;

const KIT_PAGE_PASS = Symbol.for('ogygia.kit-page-pass');
const ENTRIES = [
	'/islands/tiny.js',
	'/islands/inner.js',
	'/islands/dual.js',
	'/islands/hole.js',
	'/islands/held.js',
	LIVE_ENTRY
];

/** The build's answers, as stand-ins that name what was asked. Installed for one render. */
function install_build(known: Set<string>): void {
	deps.set_island_deps(
		Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~dep-a.js`, `${e}~dep-b.js`]]))
	);
	deps.set_island_css(Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~sheet.css`]])));
	deps.set_entry_locations(Object.fromEntries(ENTRIES.map((e) => [e, `${e}.hashed.js`])));
	deps.set_content_css({ 'post-1': ['/content/post-1.css'] });
	set_region_endpoints({
		hole_css: (entry) => [`/holes/${entry}.css`],
		mint_server_region: (entry, props, ttl, wakes) =>
			`/__ogygia__?id=${entry}&p=${encodeURIComponent(stable(props))}&ttl=${ttl}&w=${wakes}`,
		make_region_endpoint: (entry, props) =>
			`/__ogygia__?lake=${entry}&p=${encodeURIComponent(stable(props))}`,
		reuse_known_region: (fp) => known.delete(fp)
	});
}
function clear_build(): void {
	deps.set_island_deps({});
	deps.set_island_css({});
	deps.set_entry_locations({});
	deps.set_content_css({});
	set_region_endpoints(null);
}

/** Props as text for a stand-in endpoint: functions and non-JSON values named, never thrown on. */
function stable(v: unknown): string {
	return (
		JSON.stringify(v, (_k, x) =>
			typeof x === 'function'
				? `fn:${(x as { name?: string }).name ?? ''}`
				: x instanceof Map
					? { map: [...x] }
					: x
		) ?? 'undefined'
	);
}

/** What the regions above the case set in context, for its place. */
export function place_setup(place: Place): () => void {
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
		if (place.kit === 'pass') setContext(KIT_REQUEST_CONTEXT, { page: {} });
		if (place.kit === 'pass-inner') {
			setContext(KIT_PAGE_PASS, true);
			setContext(KIT_REQUEST_CONTEXT, { page: {}, event: { inner: true } });
		}
		if (place.kit === 'ogygia')
			setContext(KIT_REQUEST_CONTEXT, { page: {}, event: { root: true } });
	};
}

/** One render's parts. `thrown` is set when the render threw (and the rest is empty). */
export type ServerOut = {
	head: string;
	body: string;
	tail: string;
	/** What a grid pins, part by part: head, body, the throw, the tail and its rows, early holes,
	 *  page records, devtools events, the console. */
	parts: Record<string, string>;
	/** Every part, as one text. */
	text: string;
	thrown: string | null;
};

const DEVTOOLS = globalThis as unknown as { __OGYGIA_DEVTOOLS__?: boolean };

/** Run `fn` with the console's warn and error kept, not printed. */
function quiet<T>(fn: () => T): { value: T; said: string[] } {
	const said: string[] = [];
	const { warn, error } = console;
	console.warn = (...a: unknown[]) => void said.push(a.map(String).join(' '));
	console.error = (...a: unknown[]) => void said.push(a.map(String).join(' '));
	try {
		return { value: fn(), said };
	} finally {
		console.warn = warn;
		console.error = error;
	}
}

/**
 * One request's render of `c` at `place`: head, body and (on Kit's pass) the tail, then what the
 * request recorded (early holes, page records, devtools events) and what reached the console. With
 * `regions` the case's props are given (the fuzz's own); else made fresh from the case.
 */
export function server_out(
	c: GridCase,
	place: Place,
	regions?: () => Props[],
	devtools = true
): ServerOut {
	const req = request_for(c);
	const known = new Set<string>();
	const make = regions ?? (() => [props_for(c)]);
	if (req.known) {
		const first = render_once(make, place, req, known, devtools);
		for (const m of first.text.matchAll(/data-og-fp="([0-9a-f]+)"/g)) known.add(m[1]);
	}
	return render_once(make, place, req, known, devtools);
}

function render_once(
	make: () => Props[],
	place: Place,
	req: { building: boolean; page_version: boolean },
	known: Set<string>,
	devtools: boolean
): ServerOut {
	const route = place.csr === 'on' ? '/csr' : '/plain';
	if (place.csr === 'on')
		(place.page === 'error' ? error_csr_true_routes : csr_true_routes).add(route);
	const saved = { error: page.error, data: page.data, devtools: DEVTOOLS.__OGYGIA_DEVTOOLS__ };
	if (place.page === 'error') page.error = new Error('not found');
	page.data = PAGE_DATA;
	DEVTOOLS.__OGYGIA_DEVTOOLS__ = devtools;
	const event = {
		route: { id: route },
		request: new Request(`https://app.test${route}`),
		url: new URL(`https://app.test${route}`),
		locals: { user: 'ada' }
	};
	set_request_event_stub(() => event);
	set_kit_event_reader(() => event);
	let tail: DocumentTail | null = null;
	// (every request carries a document tail, whichever root renders: only Kit's pass writes to it)
	const t = (tail = new DocumentTail());
	set_tail_reader(() => t);
	if (req.page_version)
		set_render_page_port({ ready: () => {}, tail: () => '', version: (id) => `&pv=${id}` });
	const events: unknown[] = [];
	const records: Array<{ seed: unknown }> = [];
	set_server_devtools_recorder((e) => events.push(e));
	set_page_recorder((_snap, seed, remotes, entry) =>
		records.push({ seed, remotes, entry } as never)
	);
	set_building(req.building);
	install_build(known);
	try {
		const { value, said } = quiet(() => {
			try {
				const r = render(RegionUnder as unknown as Component<Props>, {
					props: { setup: place_setup(place), regions: make() }
				});
				return { head: r.head, body: r.body, thrown: null };
			} catch (e) {
				return { head: '', body: '', thrown: `${(e as Error).name}: ${(e as Error).message}` };
			}
		});
		const seeded = records.some((r) => r.seed !== false);
		const tail_html = tail ? tail.render(seeded ? SeedIndex.of(page.data) : null, true) : '';
		const parts: Record<string, string> = {
			head: value.head,
			body: value.body,
			thrown: value.thrown ?? '',
			tail: tail ? tail_html : '(no tail)',
			'tail holes': tail ? JSON.stringify(tail.hole_rows()) : '',
			'tail islands': tail ? JSON.stringify(tail.island_rows()) : '',
			'early holes': take_early_holes(event.request).join(' '),
			'page records': JSON.stringify(records),
			devtools: JSON.stringify(events),
			said: JSON.stringify(said)
		};
		return {
			head: value.head,
			body: value.body,
			tail: tail_html,
			parts,
			text: Object.entries(parts)
				.map(([k, v]) => `<!-- ${k} -->${v}`)
				.join('\n'),
			thrown: value.thrown
		};
	} finally {
		set_server_devtools_recorder(null);
		set_page_recorder(null);
		set_building(false);
		clear_build();
		set_request_event_stub(null);
		set_tail_reader(null);
		set_kit_event_reader(null);
		set_render_page_port(null);
		csr_true_routes.clear();
		error_csr_true_routes.clear();
		page.error = saved.error;
		page.data = saved.data;
		DEVTOOLS.__OGYGIA_DEVTOOLS__ = saved.devtools;
	}
}
