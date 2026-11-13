/**
 * Streaming `$page.data` promises into islands (csr=false): the server-side staging codec and the
 * client-side deferred registry, round-tripped. The browser wiring (island `{#await}` flips live) is
 * covered by e2e `page-data-stream.ts`; here we prove the pure pieces:
 *   stage_deferred → serialize(defer_reducer) → parse(page_defer_revivers) → pending Promise
 *   → __ogygia_page_resolve(id, ok, encoded) → the Promise settles with the decoded value.
 */
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { parse, stringify } from 'devalue';
import { scope } from '@ogygia/machine';
import { link_boot } from '../src/runtime/boot-link.ts';
import { load_devalue } from '../src/runtime/devalue-lane.ts';
import { analyze } from '../src/seed-refs.ts';
import {
	stage_deferred,
	settle_deferred,
	defer_reducer,
	page_seed_reducers,
	DeferRef,
	SettledRef,
	resolve_script
} from '../src/server/page-stream.ts';
import {
	create_deferred,
	install_page_defer,
	page_defer_revivers
} from '../src/runtime/page-defer.ts';
import {
	PAGE_DEFER_GLOBAL,
	PAGE_DEFER_REGISTRY_KEY,
	PAGE_DEFER_BOOTSTRAP
} from '../src/page-defer.ts';

const g = globalThis as unknown as Record<PropertyKey, unknown>;

/** `page_defer_revivers()` typed for devalue's `parse`: each reviver names its own payload, devalue
 *  takes `(value: any) => any` (the same hand-off `runtime/wire-format.ts` makes). */
const revivers = (): Parameters<typeof parse>[1] =>
	page_defer_revivers() as Parameters<typeof parse>[1];

// (the runtime's boot link and devalue, as a booted page whose seed carries promises has them)
beforeAll(async () => {
	link_boot();
	await load_devalue();
});

/** Fresh per-document registry + global for each case (both are singletons on globalThis). */
beforeEach(() => {
	delete g[PAGE_DEFER_REGISTRY_KEY as unknown as string];
	delete g[PAGE_DEFER_GLOBAL];
});

/** Reproduce what the browser does when a streamed resolve `<script>` runs: call the global with the
 *  raw devalue string (the engine JSON-parses the `<script>` string literal, leaving devalue text). */
function fire_resolve(id: number, ok: boolean, value: unknown) {
	(g[PAGE_DEFER_GLOBAL] as (i: number, o: boolean, e: string) => void)(id, ok, stringify(value));
}

/** `leaf` under `levels` plain objects: `{ nest: { nest: … leaf } }`. */
function nest(leaf: unknown, levels: number): unknown {
	let v = leaf;
	for (let i = 0; i < levels; i++) v = { nest: v };
	return v;
}

/** What sits `levels` deep in a {@link nest} shape. */
function unnest(v: unknown, levels: number): unknown {
	for (let i = 0; i < levels; i++) v = (v as { nest: unknown }).nest;
	return v;
}

describe('page-defer staging (server)', () => {
	it('replaces every promise with a DeferRef and collects them (data + form share one id space)', () => {
		const data = {
			locale: 'fr',
			slow: Promise.resolve('X'),
			nested: { flags: Promise.resolve(true) }
		};
		const form = { pending: Promise.resolve('F') };
		const d = stage_deferred(data, 0);
		const f = stage_deferred(form, d.next_id);
		expect(d.deferred.map((x) => x.id)).toEqual([0, 1]);
		expect(f.deferred.map((x) => x.id)).toEqual([2]);
		// Markers in place, plain values untouched.
		expect((d.staged as { locale: string }).locale).toBe('fr');
		expect((d.staged as { slow: unknown }).slow).toBeInstanceOf(DeferRef);
		expect((d.staged as { nested: { flags: unknown } }).nested.flags).toBeInstanceOf(DeferRef);
	});

	it('a promise nested 66 and 300 levels deep is staged, and the seed serializes (#569)', () => {
		for (const levels of [66, 300]) {
			const data = nest(Promise.resolve('DEEP'), levels);
			expect(analyze(data).thenable).toBe(true);
			const { staged, deferred } = stage_deferred(data, 0);
			expect(deferred, `${levels} levels`).toHaveLength(1);
			expect(() => stringify(staged, page_seed_reducers)).not.toThrow();
		}
	});

	it('promises around a deep part are staged once each, in walk order, at every depth near 64', () => {
		for (const levels of [62, 63, 64, 65, 66]) {
			const [a, deep, z] = [Promise.resolve('A'), Promise.resolve('DEEP'), Promise.resolve('Z')];
			const { staged, deferred } = stage_deferred({ a, deep: nest(deep, levels), z }, 0);
			expect(
				deferred.map((d) => d.promise),
				`${levels} levels`
			).toEqual([a, deep, z]);
			expect(deferred.map((d) => d.id)).toEqual([0, 1, 2]);
			const s = staged as { a: DeferRef; deep: unknown; z: DeferRef };
			expect([s.a.id, (unnest(s.deep, levels) as DeferRef).id, s.z.id]).toEqual([0, 1, 2]);
			expect(Object.keys(s)).toEqual(['a', 'deep', 'z']);
		}
	});

	it('a deep promise inside an array is staged too', () => {
		let data: unknown = Promise.resolve('DEEP');
		for (let i = 0; i < 100; i++) data = i % 2 ? { nest: data } : [data];
		expect(stage_deferred(data, 0).deferred).toHaveLength(1);
	});

	// (one back edge each: with two, the old walk doubled at every level, 2^64 copies)
	it('a cyclic plain value is staged once and keeps its cycle', () => {
		const data: Record<string, unknown> = { slow: Promise.resolve('X') };
		data.self = data;
		const { staged, deferred } = stage_deferred(data, 0);
		expect(deferred).toHaveLength(1);
		const s = staged as Record<string, unknown>;
		expect(s.self).toBe(s);
		expect(s).not.toBe(data);
		const revived = parse(stringify(staged, page_seed_reducers), revivers()) as Record<
			string,
			unknown
		>;
		expect(revived.self).toBe(revived);
	});

	it('a cycle through an array is staged once and keeps its cycle', () => {
		const data: Record<string, unknown> = { slow: Promise.resolve('X'), list: [] };
		(data.list as unknown[]).push(data);
		const { staged, deferred } = stage_deferred(data, 0);
		expect(deferred).toHaveLength(1);
		const s = staged as { list: unknown[] };
		expect(s.list[0]).toBe(s);
	});

	it('a sparse array keeps its holes', () => {
		// oxlint-disable-next-line no-sparse-arrays -- the hole is the point
		const { staged } = stage_deferred({ list: [1, , Promise.resolve(3)] }, 0);
		const list = (staged as { list: unknown[] }).list;
		expect(list).toHaveLength(3);
		expect(1 in list).toBe(false);
		expect(list[2]).toBeInstanceOf(DeferRef);
	});

	it('the seed walk (`analyze`) is the promise probe; a promise-free tree is false', () => {
		expect(analyze({ a: 1, b: { c: Promise.resolve(1) } }).thenable).toBe(true);
		expect(analyze({ a: 1, b: { c: [2, 3] } }).thenable).toBe(false);
		expect(analyze(null).thenable).toBe(false);
	});

	it('class instances and primitives pass through untouched (only plain objects/arrays are walked)', () => {
		const url = new URL('https://x.test/');
		const { staged, deferred } = stage_deferred({ url, n: 5, s: 'a' }, 0);
		expect(deferred).toHaveLength(0);
		expect((staged as { url: URL }).url).toBe(url);
	});
});

describe('page-defer codec round-trip', () => {
	it('a staged promise survives serialize→parse as a pending Promise, then resolves live', async () => {
		install_page_defer();
		const { staged, deferred } = stage_deferred(
			{ locale: 'fr', slow: Promise.resolve('STREAMED') },
			0
		);
		const text = stringify(staged, defer_reducer);
		const revived = parse(text, revivers()) as {
			locale: string;
			slow: Promise<unknown>;
		};
		expect(revived.locale).toBe('fr');
		expect(revived.slow).toBeInstanceOf(Promise);
		// Not settled until the resolve arrives.
		let settled = false;
		void revived.slow.then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);
		// Stream the resolution.
		fire_resolve(deferred[0].id, true, 'STREAMED');
		await expect(revived.slow).resolves.toBe('STREAMED');
	});

	it('id 0 is not dropped by the reducer (the falsy-id trap)', () => {
		// A single promise gets id 0; a bare-id reducer would read 0 as "not handled" and lose the marker.
		const { staged } = stage_deferred({ only: Promise.resolve(1) }, 0);
		const revived = parse(stringify(staged, defer_reducer), revivers()) as {
			only: unknown;
		};
		expect(revived.only).toBeInstanceOf(Promise);
	});

	it('a resolve that races AHEAD of the seed still settles (buffered, order-independent)', async () => {
		install_page_defer();
		// Resolution arrives before create_deferred(7) — buffered in the registry.
		fire_resolve(7, true, 'EARLY');
		const p = create_deferred(7);
		await expect(p).resolves.toBe('EARLY');
	});

	it('a rejected promise streams as an error and rejects the client Promise', async () => {
		install_page_defer();
		const p = create_deferred(3);
		fire_resolve(3, false, { message: 'boom' });
		await expect(p).rejects.toThrow('boom');
	});

	it('a REJECTION that races ahead of the seed rejects cleanly (no unhandled-rejection noise)', async () => {
		install_page_defer();
		let unhandled = '';
		const on = (e: PromiseRejectionEvent | { reason?: unknown }) => {
			unhandled = String(
				(e as { reason?: { message?: string } }).reason?.message ??
					(e as PromiseRejectionEvent).reason ??
					''
			);
		};
		process.on('unhandledRejection', on as (r: unknown) => void);
		// Reject arrives BEFORE the deferred exists → buffered; create_deferred returns a rejected Promise.
		fire_resolve(11, false, { message: 'early-boom' });
		const p = create_deferred(11);
		await expect(p).rejects.toThrow('early-boom');
		await new Promise((r) => setTimeout(r, 10)); // let any stray unhandled-rejection fire
		process.off('unhandledRejection', on as (r: unknown) => void);
		expect(unhandled).toBe('');
	});

	it('a promise resolving to a value with NESTED promises re-stages and streams them (Kit-style recursion)', async () => {
		install_page_defer();
		// Simulate the server: id 0 resolves to a value holding another promise → re-stage from next id.
		const outer = create_deferred(0);
		const resolved_value = { label: 'user', profile: Promise.resolve('PROFILE') };
		const restage = stage_deferred(resolved_value, 1); // ids continue past the initial set
		expect(restage.deferred.map((d) => d.id)).toEqual([1]);
		// Stream the outer resolution carrying the nested marker (encoded with defer_reducer inside).
		(g[PAGE_DEFER_GLOBAL] as (i: number, o: boolean, e: string) => void)(
			0,
			true,
			stringify(restage.staged, defer_reducer)
		);
		const v = (await outer) as { label: string; profile: Promise<unknown> };
		expect(v.label).toBe('user');
		expect(v.profile).toBeInstanceOf(Promise);
		// The nested promise is still pending until ITS resolve script lands.
		fire_resolve(restage.deferred[0].id, true, 'PROFILE');
		await expect(v.profile).resolves.toBe('PROFILE');
	});

	it('a CUSTOM transport type round-trips through a streamed resolve (injected encoders/decoders)', async () => {
		class Temp {
			c: number;
			constructor(c: number) {
				this.c = c;
			}
			get f() {
				return this.c * 1.8 + 32;
			}
		}
		const encoders = { Temp: (v: unknown) => (v instanceof Temp ? [v.c] : undefined) };
		const decoders = { Temp: (([c]: [number]) => new Temp(c)) as unknown as (p: never) => unknown };
		install_page_defer(decoders); // app transport decoders injected, like core.ts does
		const p = create_deferred(0);
		// The server would encode the streamed value with { ...transport_encoders, ...defer_reducer }.
		(g[PAGE_DEFER_GLOBAL] as (i: number, o: boolean, e: string) => void)(
			0,
			true,
			stringify(new Temp(100), { ...encoders, ...defer_reducer })
		);
		const v = (await p) as { f: number };
		expect(v.f).toBe(212); // getter works → the class was rebuilt, not a plain object
	});

	it('rich values (Date/Map) survive the streamed resolve via devalue', async () => {
		install_page_defer();
		const p = create_deferred(9);
		const when = new Date('2020-01-02T03:04:05.000Z');
		fire_resolve(9, true, { when, tags: new Map([['a', 1]]) });
		const v = (await p) as { when: Date; tags: Map<string, number> };
		expect(v.when).toBeInstanceOf(Date);
		expect(v.when.toISOString()).toBe('2020-01-02T03:04:05.000Z');
		expect(v.tags.get('a')).toBe(1);
	});
});

describe('page-defer settle path (non-navigate / SPA fallback)', () => {
	it('settle_deferred awaits each promise into a SettledRef; the client revives a resolved Promise', async () => {
		install_page_defer();
		const settled = (await settle_deferred(
			{ locale: 'fr', slow: Promise.resolve('OK') },
			scope()
		)) as {
			slow: SettledRef;
		};
		expect(settled.slow).toBeInstanceOf(SettledRef);
		const revived = parse(stringify(settled, page_seed_reducers), revivers()) as {
			locale: string;
			slow: Promise<unknown>;
		};
		expect(revived.locale).toBe('fr');
		expect(revived.slow).toBeInstanceOf(Promise); // still a Promise on this path — matches streaming + Kit
		await expect(revived.slow).resolves.toBe('OK');
	});

	it('a REJECTED promise never crashes the render; it revives as a rejected Promise (`:catch`)', async () => {
		const settled = (await settle_deferred(
			{ boom: Promise.reject(new Error('DENIED')) },
			scope()
		)) as {
			boom: SettledRef;
		};
		expect(settled.boom).toBeInstanceOf(SettledRef);
		expect(settled.boom.ok).toBe(false);
		const revived = parse(stringify(settled, page_seed_reducers), revivers()) as {
			boom: Promise<unknown>;
		};
		await expect(revived.boom).rejects.toThrow('DENIED');
	});

	it('a promise nested 66 and 300 levels deep is settled, and the seed serializes (#569)', async () => {
		for (const levels of [66, 300]) {
			const settled = await settle_deferred(nest(Promise.resolve('DEEP'), levels), scope());
			const leaf = unnest(settled, levels);
			expect(leaf, `${levels} levels`).toBeInstanceOf(SettledRef);
			expect((leaf as SettledRef).value).toBe('DEEP');
			expect(() => stringify(settled, page_seed_reducers)).not.toThrow();
		}
	});

	it('a deep rejected promise is settled as an error, never left unhandled (#569)', async () => {
		const unhandled: unknown[] = [];
		const on_unhandled = (reason: unknown) => void unhandled.push(reason);
		process.on('unhandledRejection', on_unhandled);
		try {
			const settled = await settle_deferred(nest(Promise.reject(new Error('DEEP')), 66), scope());
			const leaf = unnest(settled, 66) as SettledRef;
			expect(leaf).toBeInstanceOf(SettledRef);
			expect(leaf.ok).toBe(false);
			// (node reports an unhandled rejection after the microtasks drain)
			await new Promise((r) => setTimeout(r, 10));
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', on_unhandled);
		}
	});

	it('a cyclic plain value is settled once and keeps its cycle', async () => {
		let calls = 0;
		// oxlint-disable-next-line unicorn/no-thenable -- a thenable (as Kit hands over), counted
		const slow = { then: (ok: (v: string) => void) => (calls++, ok('X')) };
		const data: Record<string, unknown> = { slow };
		data.self = data;
		const s = (await settle_deferred(data, scope())) as Record<string, unknown>;
		expect(calls).toBe(1);
		expect(s.self).toBe(s);
		expect(s.slow).toBeInstanceOf(SettledRef);
		expect(() => stringify(s, page_seed_reducers)).not.toThrow();
	});

	it('settle keeps the key order of the data, whichever promise settles first', async () => {
		let late!: (v: string) => void;
		const settled = settle_deferred(
			{
				a: new Promise<string>((r) => (late = r)),
				b: Promise.resolve('B'),
				c: 1
			},
			scope()
		);
		await new Promise((r) => setTimeout(r, 0));
		late('A');
		expect(Object.keys((await settled) as object)).toEqual(['a', 'b', 'c']);
	});

	it('settle_deferred recurses into a resolved value that holds more promises', async () => {
		const settled = (await settle_deferred(
			{ user: Promise.resolve({ profile: Promise.resolve('P') }) },
			scope()
		)) as {
			user: SettledRef;
		};
		expect(settled.user).toBeInstanceOf(SettledRef);
		expect((settled.user.value as { profile: SettledRef }).profile).toBeInstanceOf(SettledRef);
		const revived = parse(stringify(settled, page_seed_reducers), revivers()) as {
			user: Promise<{ profile: Promise<unknown> }>;
		};
		const u = await revived.user;
		await expect(u.profile).resolves.toBe('P');
	});
});

describe('page-defer script safety', () => {
	it('resolve_script escapes `<` so a payload cannot break out of the <script>', () => {
		const s = resolve_script(PAGE_DEFER_GLOBAL, 0, { ok: true, value: '</script><img src=x>' });
		expect(s.startsWith(`<script>${PAGE_DEFER_GLOBAL}(0,true,`)).toBe(true);
		// No raw `</script` or `<` inside the argument.
		const arg = s.slice(s.indexOf(',true,') + 6, -('</script>'.length + 1));
		expect(arg).not.toContain('</script');
		expect(arg).not.toContain('<');
	});

	it('a non-serializable resolution degrades to a typed error, never hangs', () => {
		const s = resolve_script(PAGE_DEFER_GLOBAL, 1, { ok: true, value: () => 42 });
		expect(s).toContain('(1,false,');
		expect(s).toContain('not serializable');
	});

	it('the inline bootstrap defines the resolve global and queues until live', () => {
		// Run the bootstrap in this realm. It is the inline script's text, so it runs as the browser runs
		// an inline script: an indirect eval, global scope.
		// oxlint-disable-next-line no-eval
		(0, eval)(PAGE_DEFER_BOOTSTRAP);
		expect(typeof g[PAGE_DEFER_GLOBAL]).toBe('function');
		// Before install, a call is queued (no throw).
		expect(() =>
			(g[PAGE_DEFER_GLOBAL] as (i: number, o: boolean, e: string) => void)(0, true, stringify('q'))
		).not.toThrow();
		// install drains the queue into a pending deferred created afterwards.
		install_page_defer();
	});
});
