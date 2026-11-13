// An app's callback that throws inside a loop that must go on (a ref watcher, a kind's dispose, a
// page store subscriber, a navigation hook, a source receipt seam, a devtools sink): the others still
// run, and the error is not dropped. It goes to the page's error handler (`reportError`: the console
// and window.onerror, where error monitoring sees it), or is printed where there is none (a server).
import { afterEach, describe, expect, it, vi } from 'vitest';

// (the devtools bus's compile gate, on before it is imported)
(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { watch, notify, register_kind, resolve, dispose_ids } = await import('../src/ref.ts');
const { subscribe_page, set_page } = await import('../src/shims/page-store.svelte.ts');
const { SpaRouter } = await import('../src/runtime/router.ts');
const { record_source_read, set_source_recorder, set_source_observer } =
	await import('../src/source.ts');
const { add_sink, configure, emit } = await import('../src/events/bus.ts');

const boom = (what: string) => () => {
	throw new Error(what);
};

/** The errors the page's handler got while `run` ran. */
function reported(run: () => void): unknown[] {
	const got: unknown[] = [];
	vi.stubGlobal('reportError', (e: unknown) => got.push(e));
	try {
		run();
	} finally {
		vi.unstubAllGlobals();
	}
	return got;
}

const messages = (errors: unknown[]) => errors.map((e) => (e as Error).message);

afterEach(() => {
	vi.restoreAllMocks();
	set_source_recorder(null);
	set_source_observer(null);
});

describe("an app's callback that throws is reported, and the rest still run", () => {
	it('a ref watcher', () => {
		const seen: unknown[] = [];
		const off_a = watch('cb-ref', boom('watcher a'));
		const off_b = watch('cb-ref', (v) => seen.push(v));
		const errors = reported(() => notify('cb-ref', 1));
		off_a();
		off_b();
		expect(seen).toEqual([1]);
		expect(messages(errors)).toEqual(['watcher a']);
	});

	it("a kind's dispose", () => {
		const ran: string[] = [];
		register_kind({
			k: 'cb-disposable',
			match: () => false,
			encode: () => ({}),
			decode: (ref) => ({ id: ref.i }),
			dispose: (live) => {
				const { id } = live as { id: string };
				if (id === 'cb-a') throw new Error('dispose');
				ran.push(id);
			}
		});
		resolve({ k: 'cb-disposable', i: 'cb-a' }, 'page');
		resolve({ k: 'cb-disposable', i: 'cb-b' }, 'page');
		const errors = reported(() => dispose_ids(['cb-a', 'cb-b']));
		expect(ran).toEqual(['cb-b']);
		expect(messages(errors)).toEqual(['dispose']);
	});

	it('a page store subscriber', () => {
		let ran = false;
		const off_a = subscribe_page(boom('subscriber'));
		const off_b = subscribe_page(() => (ran = true));
		const errors = reported(() => set_page({ status: 200 }));
		off_a();
		off_b();
		expect(ran).toBe(true);
		expect(messages(errors)).toEqual(['subscriber']);
	});

	it('a navigation hook (before, after, and after at once as it is added)', () => {
		const router = new SpaRouter();
		const from = new URL('http://app.test/a');
		const to = new URL('http://app.test/b');
		let before_ran = false;
		router.beforeNavigate(boom('before'));
		router.beforeNavigate(() => (before_ran = true));
		const before = reported(() => {
			expect(router.run_before(from, to, 'link')).toBe(true);
		});
		expect(before_ran).toBe(true);
		expect(messages(before)).toEqual(['before']);

		let after_ran = 0;
		const added = reported(() => {
			// (an after hook is called at once with the page it was added on)
			vi.stubGlobal('location', new URL('http://app.test/a'));
			router.afterNavigate(boom('after'));
			router.afterNavigate(() => void after_ran++);
		});
		expect(messages(added)).toEqual(['after']);
		const after = reported(() => router.run_after(from, to, 'link'));
		expect(after_ran).toBe(2);
		expect(messages(after)).toEqual(['after']);
	});

	it('a source receipt seam', () => {
		const observed: string[] = [];
		set_source_recorder(boom('recorder'));
		set_source_observer((tag) => observed.push(tag));
		const errors = reported(() => record_source_read('s:doc:1'));
		expect(observed).toEqual(['s:doc:1']);
		expect(messages(errors)).toEqual(['recorder']);
	});

	it('a devtools sink', () => {
		configure({ active: true, cap: 64 });
		const seen: string[] = [];
		const off_a = add_sink(boom('sink'));
		const off_b = add_sink((e) => seen.push(e.name));
		const errors = reported(() => emit({ domain: 'runtime', name: 'region.prefetch' } as never));
		off_a();
		off_b();
		expect(seen).toEqual(['region.prefetch']);
		expect(messages(errors)).toEqual(['sink']);
	});

	it('off a page (no reportError), the error is printed', () => {
		const printed: unknown[] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			printed.push(a[0]);
		});
		const off = watch('cb-ref-server', boom('on the server'));
		notify('cb-ref-server', 1);
		off();
		expect(messages(printed)).toEqual(['on the server']);
	});
});
