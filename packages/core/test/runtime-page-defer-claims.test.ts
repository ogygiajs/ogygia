/**
 * What `runtime/page-defer.ts` states, against the source: a resolve the inline bootstrap queued
 * settles once the runtime installs; with no bootstrap the install defines the resolve global; two
 * copies of the runtime share one registry; the first install's decoders win; ogygia's markers win
 * over an app decoder of the same name; a marker read twice is one promise.
 */
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { parse, stringify } from 'devalue';
import { DeferRef, defer_reducer } from '../src/server/page-stream.ts';
import { link_boot } from '../src/runtime/boot-link.ts';
import { load_devalue } from '../src/runtime/devalue-lane.ts';
import {
	create_deferred,
	install_page_defer,
	page_defer_revivers
} from '../src/runtime/page-defer.ts';
import {
	PAGE_DEFER_BOOTSTRAP,
	PAGE_DEFER_GLOBAL,
	PAGE_DEFER_KEY,
	PAGE_DEFER_REGISTRY_KEY
} from '../src/page-defer.ts';

const g = globalThis as unknown as Record<PropertyKey, unknown>;
const resolve = (id: number, ok: boolean, value: unknown) =>
	(g[PAGE_DEFER_GLOBAL] as (i: number, o: boolean, e: string) => void)(id, ok, stringify(value));

beforeAll(async () => {
	link_boot();
	await load_devalue();
});

beforeEach(() => {
	delete g[PAGE_DEFER_REGISTRY_KEY as unknown as string];
	delete g[PAGE_DEFER_GLOBAL];
});

it('a resolve the inline bootstrap queued settles its promise once the runtime installs', async () => {
	// oxlint-disable-next-line no-eval -- the bootstrap is an inline script's text: run it as the browser does
	(0, eval)(PAGE_DEFER_BOOTSTRAP);
	resolve(5, true, 'queued');
	install_page_defer();
	await expect(create_deferred(5)).resolves.toBe('queued');
});

it('with no inline bootstrap, the install defines the resolve global', async () => {
	install_page_defer();
	expect(typeof g[PAGE_DEFER_GLOBAL]).toBe('function');
	const p = create_deferred(1);
	resolve(1, true, 'direct');
	await expect(p).resolves.toBe('direct');
});

it('two copies of the runtime share one registry (dev evaluates the runtime twice)', async () => {
	vi.resetModules();
	const copy =
		(await import('../src/runtime/page-defer.ts')) as typeof import('../src/runtime/page-defer.ts');
	expect(copy.create_deferred).not.toBe(create_deferred);
	const p = copy.create_deferred(2);
	install_page_defer();
	resolve(2, true, 'shared');
	await expect(p).resolves.toBe('shared');
});

it('a second install changes nothing: the first call’s decoders win', async () => {
	class A {}
	class B {}
	const encode = { T: (v: unknown) => (v instanceof A || v instanceof B ? [1] : undefined) };
	install_page_defer({ T: (() => new A()) as (p: never) => unknown });
	install_page_defer({ T: (() => new B()) as (p: never) => unknown });
	const p = create_deferred(3);
	(g[PAGE_DEFER_GLOBAL] as (i: number, o: boolean, e: string) => void)(
		3,
		true,
		stringify(new A(), encode)
	);
	expect(await p).toBeInstanceOf(A);
});

it('ogygia’s markers win over an app decoder of the same name', () => {
	const revivers = page_defer_revivers({
		[PAGE_DEFER_KEY]: (() => 'app') as (p: never) => unknown
	});
	const marker = stringify({ x: new DeferRef(4) }, defer_reducer);
	const seed = parse(marker, revivers as Parameters<typeof parse>[1]) as { x: unknown };
	expect(seed.x).toBeInstanceOf(Promise);
});

it('a marker read twice is one promise', () => {
	expect(create_deferred(6)).toBe(create_deferred(6));
});

/** A document still loading: its `load` fires when the test says. */
function loading_document(): { load(): void } {
	let on_load: (() => void) | undefined;
	vi.stubGlobal('document', { readyState: 'loading' });
	vi.stubGlobal('addEventListener', (type: string, fn: () => void) => {
		if (type === 'load') on_load = fn;
	});
	return {
		load() {
			vi.stubGlobal('document', { readyState: 'complete' });
			on_load?.();
		}
	};
}

it('a streamed promise whose resolve never came is rejected once the document has loaded', async () => {
	const doc = loading_document();
	try {
		install_page_defer();
		const cut = create_deferred(8);
		const came = create_deferred(9);
		resolve(9, true, 'here');
		doc.load();
		await expect(came).resolves.toBe('here');
		await expect(cut).rejects.toThrow('page_promise_unresolved');
	} finally {
		vi.unstubAllGlobals();
	}
});

it('a marker read again after its value arrived early is the same settled promise (#1435)', async () => {
	vi.stubGlobal('document', { readyState: 'complete' });
	try {
		install_page_defer();
		// (the resolve script ran before any island read the marker)
		resolve(11, true, 'early');
		// (devalue is loaded: its value lands within the task)
		await new Promise((done) => setTimeout(done, 0));
		const first = create_deferred(11);
		const again = create_deferred(11);
		expect(again).toBe(first);
		await expect(again).resolves.toBe('early');
	} finally {
		vi.unstubAllGlobals();
	}
});

it('a marker read again after its value arrived while waited on is the same settled promise (#1435)', async () => {
	const doc = loading_document();
	try {
		install_page_defer();
		const first = create_deferred(12);
		resolve(12, true, 'waited');
		await expect(first).resolves.toBe('waited');
		doc.load();
		const again = create_deferred(12);
		expect(again).toBe(first);
		await expect(again).resolves.toBe('waited');
	} finally {
		vi.unstubAllGlobals();
	}
});

it('a streamed promise read after the document loaded, with no resolve, is rejected at once', async () => {
	vi.stubGlobal('document', { readyState: 'complete' });
	try {
		install_page_defer();
		await expect(create_deferred(10)).rejects.toThrow('page_promise_unresolved');
	} finally {
		vi.unstubAllGlobals();
	}
});

it('a streamed promise that never got its value rejects with the coded error, not a copy of its message (#1504)', async () => {
	vi.stubGlobal('document', { readyState: 'complete' });
	try {
		install_page_defer();
		await expect(create_deferred(11)).rejects.toMatchObject({
			name: 'OgygiaError',
			code: 'page_promise_unresolved'
		});
	} finally {
		vi.unstubAllGlobals();
	}
});
