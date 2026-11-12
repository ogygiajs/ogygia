import { describe, expect, it } from 'vitest';
import { ogygiaTransport } from '../src/transport.ts';
import { REGION_BRAND } from '../src/region.ts';

const { encode, decode } = ogygiaTransport.Region;

const inline = (extra: Record<string, unknown> = {}) => ({
	[REGION_BRAND]: true,
	kind: 'inline' as const,
	component: () => {},
	props: { a: 1 },
	...extra
});

describe('transport — HTML-baked inline tickets', () => {
	it('an AWAITED inline region (html present) crosses as an HTML-only ticket (+ its hub id)', () => {
		const t = encode(inline({ html: '<p>hi</p>' })) as Record<string, unknown>;
		// `hi` is the HUB identity — minted per instance; the browser reunites decodes by it
		expect(typeof t.hi).toBe('string');
		expect((t.hi as string).length).toBeGreaterThan(0);
		const { hi: _hi, ...wire } = t;
		expect(wire).toEqual({ i: '', p: { a: 1 }, u: '', m: '', x: '<p>hi</p>' });
	});

	it('the SAME region instance encodes with the SAME hub id (identity memo)', () => {
		const value = inline({ html: '<p>hi</p>' });
		const a = encode(value) as Record<string, unknown>;
		const b = encode(value) as Record<string, unknown>;
		expect(a.hi).toBe(b.hi);
		expect(encode(inline({ html: '<p>hi</p>' }))).not.toHaveProperty('hi', a.hi); // new instance → new id
	});

	it('an un-awaited inline region still throws, and the error teaches `await`', () => {
		expect(() => encode(inline())).toThrow(/`await` the region/);
	});

	it('decode revives an HTML-only ticket as a deferred region carrying the html (no frame write)', () => {
		// node has no `document`, and the ticket has no url — both paths skip the frame store.
		const d = decode({ i: '', p: {}, u: '', m: '', x: '<p>hi</p>' }) as Record<string, unknown>;
		expect(d.kind).toBe('deferred');
		expect(d.html).toBe('<p>hi</p>');
		expect(d.url).toBe('');
	});

	it('non-regions are passed over (encode returns false)', () => {
		expect(encode({ html: 'nope' })).toBe(false);
		expect(encode(null)).toBe(false);
	});
});

describe('region(C, props, { version }) — the data version rides the wire (#682)', () => {
	/** A held region's server binding, as the compiler emits it. */
	const binding = () => ({
		__ogRegion: 'card',
		__module: '',
		__component: () => {},
		__sign: (id: string) => `/__ogygia__?id=${id}&props=e30&sig=x`,
		__renderHtml: () => '<p>card</p>'
	});
	const wire = async (version: unknown) => {
		const { region } = await import('../src/region.ts');
		const r = await region(binding() as never, {} as never, { version } as never);
		return encode(r) as Record<string, unknown>;
	};

	it('a number crosses as itself', async () => {
		expect((await wire(7)).d).toBe(7);
	});

	it('a Date and an ISO string cross as the same number', async () => {
		const at = '2026-11-11T10:00:00.000Z';
		expect((await wire(new Date(at))).d).toBe(Date.parse(at));
		expect((await wire(at)).d).toBe(Date.parse(at));
	});

	it('no version, no field', async () => {
		const { region } = await import('../src/region.ts');
		const r = await region(binding() as never, {} as never);
		expect(encode(r)).not.toHaveProperty('d');
	});

	it('a version that is not a number, a Date or a date string throws, naming the code', async () => {
		await expect(wire('soon')).rejects.toThrow(/region_version_invalid/);
		await expect(wire(Number.NaN)).rejects.toThrow(/region_version_invalid/);
	});

	it('a decoded region crosses again with its version', () => {
		const back = decode({ i: 'card', p: {}, u: '/__ogygia__?id=card', m: '', x: '<p/>', d: 4 });
		expect((encode(back) as Record<string, unknown>).d).toBe(4);
	});
});

describe('region() inline awaitability', () => {
	it('region(C, props) is thenable, and `then` is non-enumerable (devalue/spread never see it)', async () => {
		const { region } = await import('../src/region.ts');
		const r = region((() => {}) as never, {} as never);
		expect(typeof (r as { then?: unknown }).then).toBe('function');
		expect(Object.keys(r)).not.toContain('then');
		// spreading drops the thenable — the settled copy must not re-arm `await`
		const copy = { ...r };
		expect((copy as { then?: unknown }).then).toBeUndefined();
	});
});

describe('ogygiaTransport OgygiaRef entry — symmetry (hub v2 phase Y)', () => {
	it("a store crosses Kit's transport by identity (page.data / remote can carry one)", async () => {
		const { writable, get } = await import('svelte/store');
		const { register_store_kind } = await import('../src/store-transport.ts');
		register_store_kind();
		const entry = (
			ogygiaTransport as Record<
				string,
				{ encode: (v: unknown) => unknown; decode: (d: never) => unknown }
			>
		)['OgygiaRef'];
		expect(entry).toBeDefined();

		const s = writable(7);
		const enc = entry.encode(s) as { k: string } | false;
		expect(enc).not.toBe(false);
		expect((enc as { k: string }).k).toBe('store'); // claimed as a store ref

		const revived = entry.decode(enc as never) as ReturnType<typeof writable>;
		expect(get(revived)).toBe(7); // value crossed; a live store on the other side
	});

	it('plain data is DECLINED (false) so Kit serializes it natively', () => {
		const entry = (ogygiaTransport as Record<string, { encode: (v: unknown) => unknown }>)[
			'OgygiaRef'
		];
		expect(entry.encode({ plain: 1 })).toBe(false);
		expect(entry.encode(42)).toBe(false);
		expect(entry.encode('x')).toBe(false);
	});

	it('Region entry stays FIRST so regions keep the legacy wire shape', () => {
		const keys = Object.keys(ogygiaTransport);
		expect(keys[0]).toBe('Region'); // first-match order: regions never reach OgygiaRef on encode
	});
});
