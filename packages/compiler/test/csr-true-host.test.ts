// A csr=true route host: Kit compiles and hydrates the page, so its own wake islands become plain
// imports (`asRegion` is refused, as everywhere). Checked on the compiled text itself, plus a
// property over generated import blocks: every wake import loses its `with` clause, every other
// import stays byte for byte, and the output still parses.
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'svelte/compiler';
import { fc } from '@ogygia/config/sim';
import { transformHost, normalize_import_keys } from '../src/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const HOST = '/app/src/routes/kit/+page.svelte';

function ctx(overrides: Partial<Parameters<typeof transformHost>[2]> = {}) {
	return {
		...HOST_CTX_DEFAULTS,
		routeCsr: true,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		...overrides
	} as Parameters<typeof transformHost>[2];
}

const host = (script: string, markup = '<Counter />') => dedent`
	<script>
	${script}
	</script>
	${markup}
`;

/** The `<script>` body of a compiled host. */
const script_of = (code: string) =>
	code.slice(code.indexOf('<script>') + 8, code.indexOf('</script>'));

describe('csr=true host: region imports become plain imports', () => {
	it('drops the `with { wake }` clause and keeps the import itself', () => {
		const out = transformHost(
			host(`import Counter from '$lib/Counter.svelte' with { wake: 'load' };`),
			HOST,
			ctx()
		);
		expect(out).not.toBeNull();
		expect(script_of(out!.code).trim()).toBe(`import Counter from '$lib/Counter.svelte';`);
		expect(out!.islands).toEqual([]);
	});

	// (a region the server drives stays a region here: csr-true-host-regions.test.ts)
	it('drops the keys of every wake island: wake, and a preset that wakes', () => {
		const lines = [
			`import A from './A.svelte' with { wake: 'visible' };`,
			`import B from './B.svelte' with { wake: 'idle' };`,
			`import C from './C.svelte' with { preset: 'below' };`
		];
		const out = transformHost(
			host(lines.join('\n')),
			HOST,
			ctx({ presets: { below: { wake: 'visible' } } })
		)!;
		expect(script_of(out.code).trim().split('\n')).toEqual([
			`import A from './A.svelte';`,
			`import B from './B.svelte';`,
			`import C from './C.svelte';`
		]);
	});

	it('leaves imports without a region key alone, attributes and all', () => {
		const keep = [
			`import data from './data.json' with { type: 'json' };`,
			`import Plain from './Plain.svelte';`,
			`import { wake } from './named.ts';`
		];
		const src = host(
			[`import Counter from './Counter.svelte' with { wake: 'load' };`, ...keep].join('\n')
		);
		const out = transformHost(src, HOST, ctx())!;
		for (const line of keep) expect(out.code).toContain(line);
		expect(out.code).not.toContain(`with { wake`);
	});

	it('reads the configured key names, not the default ones', () => {
		const keys = normalize_import_keys({ wake: 'hydrate' });
		const src = host(dedent`
			import A from './A.svelte' with { hydrate: 'load' };
			import B from './B.svelte' with { type: 'wake' };
		`);
		const out = transformHost(src, HOST, ctx({ importKeys: keys }))!;
		expect(out.code).toContain(`import A from './A.svelte';`);
		expect(out.code).toContain(`import B from './B.svelte' with { type: 'wake' };`);
	});

	it('refuses `asRegion(Comp, …)` as a csr=false page does, printing the import to write', () => {
		const src = host(
			dedent`
				import Counter from './Counter.svelte';
				let later;
				const n = 1;
				const Live = import.meta.og.asRegion(Counter, { wake: 'load' });
			`,
			'<Live />'
		);
		expect(() => transformHost(src, HOST, ctx())).toThrow(
			expect.objectContaining({
				code: 'as_region_removed',
				message: expect.stringContaining(
					`import Live from './Counter.svelte' with { wake: 'load' };`
				)
			})
		);
	});

	it('strips the mark off a named import too', () => {
		const out = transformHost(
			host(`import { Counter } from './parts' with { wake: 'load' };`, '<Counter />'),
			HOST,
			ctx()
		)!;
		expect(out.code).toContain(`import { Counter } from './parts';`);
	});

	it('maps the output back to the source it was given', () => {
		const src = host(`import Counter from './Counter.svelte' with { wake: 'load' };`);
		const out = transformHost(src, HOST, ctx())!;
		expect(out.map.sources).toEqual([HOST]);
		expect(out.map.sourcesContent).toEqual([src]);
	});

	it('a host that does not parse is skipped once, with a warning that names it', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const bad = host(`import Counter from './Counter.svelte' with { wake: 'load' };`, '{#if}');
			const id = '/app/src/routes/broken-csr-true/+page.svelte';
			expect(transformHost(bad, id, ctx())).toBeNull();
			expect(transformHost(bad, id, ctx())).toBeNull();
			const said = warn.mock.calls.filter((c) => String(c[0]).includes(`skipped ${id}`));
			expect(said).toHaveLength(1);
		} finally {
			warn.mockRestore();
		}
	});

	it('returns null for a host with no region import and no asRegion', () => {
		expect(transformHost(host(`import Plain from './Plain.svelte';`), HOST, ctx())).toBeNull();
	});
});

// the keys of a wake island (Kit hydrates it: plain here); a server-driven region stays a region
// (csr-true-host-regions.test.ts)
const REGION_ATTRS = [`wake: 'load'`, `wake: 'idle'`, `wake: 'visible'`];
const OTHER_ATTRS = [`type: 'json'`, `type: 'css'`];

type Imp = { name: string; attrs: string[] };
const an_import = fc.record({
	name: fc.constantFrom('A', 'B', 'C', 'Wake', 'Fetch'),
	// (a region key beside `type` is refused, as in any host: one clause is one or the other)
	attrs: fc.oneof(
		fc.subarray(REGION_ATTRS, { maxLength: 3 }),
		fc.subarray(OTHER_ATTRS, { maxLength: 2 })
	)
});

/** One import line; a key may appear once per clause, so the second `wake`/`type` is dropped. */
function line_of(imp: Imp, i: number): { text: string; has_region: boolean } {
	const seen = new Set<string>();
	const attrs = imp.attrs.filter((a) => {
		const k = a.slice(0, a.indexOf(':'));
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	const spec = `'./${imp.name}${i}.svelte'`;
	const text = attrs.length
		? `import ${imp.name}${i} from ${spec} with { ${attrs.join(', ')} };`
		: `import ${imp.name}${i} from ${spec};`;
	return { text, has_region: attrs.some((a) => REGION_ATTRS.includes(a)) };
}

describe('csr=true host: property over import blocks', () => {
	it('strips exactly the imports that name a region key, and the output parses', () => {
		fc.assert(
			fc.property(fc.array(an_import, { minLength: 1, maxLength: 6 }), (imps) => {
				const lines = imps.map(line_of);
				const src = host(lines.map((l) => l.text).join('\n'), '<p>page</p>');
				const out = transformHost(src, HOST, ctx());
				if (!lines.some((l) => l.has_region)) {
					// no hint, no asRegion: the host is not touched at all
					expect(out).toBeNull();
					return;
				}
				expect(out).not.toBeNull();
				const got = script_of(out!.code).trim().split('\n');
				expect(got).toEqual(
					lines.map((l) =>
						l.has_region ? `${l.text.slice(0, l.text.indexOf(' with {'))};` : l.text
					)
				);
				expect(() => parse(out!.code, { modern: true })).not.toThrow();
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 314),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 100)
			}
		);
	});
});
