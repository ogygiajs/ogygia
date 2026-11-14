// Transform suite — portable binding rewrite (0.4.0). Asserts host import rewrites, wrapper/entry
// virtual modules, path+strategy dedupe, props/fallback/children rules, defer+hydrate, lakes,
// presets, and csr-independent emit metadata.

import { describe, test, expect } from 'vitest';
import {
	transformHost,
	normalize_import_keys,
	import_keys_hint,
	islandPublicUrl,
	islandChunkFileName,
	regionIdentity,
	regionId,
	strategyKey,
	wrapperVirtualId,
	regionBindingVirtualId,
	CLIENT_BINDING_STUB,
	foucCssVirtualId
} from '../src/compiler/region/transform.ts';
import type { MarkOptions } from '../src/compiler/region/ir.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/app';
const HOST = '/app/src/routes/+page.svelte';

type HostCtx = Parameters<typeof transformHost>[2];

function idFor(compRel: string, mark: { strategy: string; options?: MarkOptions }, salt = '') {
	return regionId(regionIdentity(compRel, mark), salt);
}

function makeCtx(overrides: Partial<HostCtx> = {}): HostCtx {
	return {
		...HOST_CTX_DEFAULTS,
		root: ROOT,
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_hostId: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_hostId: string, iid: string) => wrapperVirtualId(iid),
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		...overrides
	};
}

type Result = NonNullable<ReturnType<typeof transformHost>>;

function run(src: string, ctx = makeCtx()): Result | null {
	return transformHost(src, HOST, ctx);
}

function wrap(imports: string, markup: string): string {
	return dedent`
		<script>
		${imports}
		</script>
		${markup}
	`;
}

function expectThrows(fn: () => unknown, re: RegExp): string {
	let msg = '';
	let threw = false;
	try {
		fn();
	} catch (e) {
		threw = true;
		msg = (e as Error).message;
	}
	expect(threw, 'expected a build error').toBe(true);
	expect(msg).toMatch(re);
	return msg;
}

const LOAD = `import C from './C.svelte' with { wake: 'load' };`;
const C_REL = 'src/routes/C.svelte';
const loadMark = { strategy: 'load', options: {} };

describe('normalize_import_keys', () => {
	test('defaults', () => {
		expect(normalize_import_keys()).toEqual({
			wake: 'wake',
			fetch: 'fetch',
			render: 'render',
			preset: 'preset',
			region: 'region'
		});
	});
	test('rejects collisions', () => {
		expect(() => normalize_import_keys({ wake: 'x', render: 'x' })).toThrow(/distinct/);
	});
	test('one config object resolves to one key map, and one key map to one hint', () => {
		const overrides = { wake: 'hydrate' };
		const keys = normalize_import_keys(overrides);
		expect(normalize_import_keys(overrides)).toBe(keys);
		expect(normalize_import_keys()).toBe(normalize_import_keys(null));
		expect(import_keys_hint(keys)).toBe(import_keys_hint(keys));
	});
});

describe('strategyKey / regionIdentity dedupe', () => {
	test('same path + load → same id', () => {
		const a = idFor('src/lib/A.svelte', loadMark);
		const b = idFor('src/lib/A.svelte', { strategy: 'load', options: {} });
		expect(a).toBe(b);
	});
	test('different strategies → different ids', () => {
		expect(idFor('src/lib/A.svelte', loadMark)).not.toBe(
			idFor('src/lib/A.svelte', { strategy: 'visible', options: { margin: '0px' } })
		);
	});
	test('strategyKey encodes defer+hydrate combo', () => {
		expect(
			strategyKey({
				strategy: 'server',
				options: { when: 'idle', hydrate: 'visible', hydrateMargin: '10px' }
			})
		).toBe('defer:idle+hydrate:visible:hmargin:10px');
	});
	test('strategyKey fingerprints cache ttl (a cached hole never dedupes onto a no-store one)', () => {
		const plain = strategyKey({ strategy: 'server', options: { when: 'load' } });
		const cached = strategyKey({
			strategy: 'server',
			options: { when: 'load', cacheTtlSec: 3600 }
		});
		expect(plain).toBe('defer:load');
		expect(cached).toBe('defer:load:ttl:3600');
		expect(cached).not.toBe(plain);
	});
});

describe('foucCssVirtualId', () => {
	test('builds .js virtual FOUC CSS ids (encoded path)', () => {
		expect(foucCssVirtualId('src/lib/SideNav.svelte')).toBe(
			`ogygia:region/fouc-css/${encodeURIComponent('src/lib/SideNav.svelte')}.js`
		);
		expect(foucCssVirtualId('src\\routes\\A.svelte')).toBe(
			`ogygia:region/fouc-css/${encodeURIComponent('src/routes/A.svelte')}.js`
		);
		expect(foucCssVirtualId('src/lib/SideNav.svelte').endsWith('.js')).toBe(true);
	});
});

describe('portable binding rewrite', () => {
	test('marked import becomes wrapper virtual; template keeps <C />', () => {
		const r = run(wrap(LOAD, '<C />'))!;
		const iid = idFor(C_REL, loadMark);
		// A wake import lands on the ATTACH BINDING (placeable + holdable); the wrapper still exists.
		expect(r.code).toMatch(
			new RegExp(`import C from ["']${regionBindingVirtualId(iid).replace(/\./g, '\\.')}["']`)
		);
		expect(r.code).toMatch(/<C\s*\/>/);
		expect(r.code).not.toMatch(/OgygiaRegion__Wrapper/);
		expect(r.code).not.toMatch(/with \{ hydrate/);
		expect(r.islands).toHaveLength(1);
		expect(r.islands[0].id).toBe(iid);
		expect(r.islands[0].virtualPath).toBe(`ogygia:region/entry/${iid}.js`);
		expect(r.islands[0].wrapperPath).toBe(wrapperVirtualId(iid));
		expect(r.islands[0].bindingPath).toBe(regionBindingVirtualId(iid));
		// SSR leg attaches the descriptor onto the wrapper; client leg is metadata-only.
		expect(String(r.islands[0].bindingSsrSource)).toMatch(/Object\.assign\(__OgygiaWrap/);
		expect(String(r.islands[0].bindingSsrSource)).toContain('__hydrate: "load"');
		expect(String(r.islands[0].bindingClientSource)).not.toContain('makeRegionEndpoint');
		expect(r.islands[0].kind).toBe('hydrate');
		expect(r.islands[0].source).toMatch(/export default __OgygiaComp_/);
		expect(r.islands[0].wrapperSource).toMatch(/OgygiaRegion__Wrapper __mode="island" load/);
		expect(r.islands[0].wrapperSource).toMatch(
			new RegExp(
				`__entry=\\{${JSON.stringify(islandPublicUrl(iid)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`
			)
		);
	});

	test('appDir threads into the baked island entry URL (no hardcoded _app, no baked base)', () => {
		const iid = idFor(C_REL, loadMark);
		// Default ctx (no appDir): /_app/ogygia/… (the stable names live outside immutable/).
		const def = run(wrap(LOAD, '<C />'))!;
		expect(def.islands[0].wrapperSource).toContain(`__entry={"/_app/ogygia/og-region.${iid}.js"}`);
		// Custom SvelteKit appDir: it rides the URL, no `_app` leaks. base is NOT baked here — Region's
		// asset() adds it at SSR — so the URL stays a leading-slash app path.
		const custom = run(wrap(LOAD, '<C />'), makeCtx({ appDir: 'internal' }))!;
		expect(custom.islands[0].wrapperSource).toContain(
			`__entry={"/internal/ogygia/og-region.${iid}.js"}`
		);
		expect(custom.islands[0].wrapperSource).not.toContain('/_app/');
	});

	test('islandChunkFileName / islandPublicUrl honor appDir (base-less)', () => {
		// Output filename: appDir-prefixed, no leading slash (an on-disk build path).
		// (under `<appDir>/ogygia/`, never `immutable/`: a stable name a host cached for a year would
		// load another build's code)
		expect(islandChunkFileName('abc')).toBe('_app/ogygia/og-region.abc.js');
		expect(islandChunkFileName('abc', 'internal')).toBe('internal/ogygia/og-region.abc.js');
		// Public URL: leading slash + appDir, NEVER a base (asset() applies base/assets at render).
		expect(islandPublicUrl('abc')).toBe('/_app/ogygia/og-region.abc.js');
		expect(islandPublicUrl('abc', 'internal')).toBe('/internal/ogygia/og-region.abc.js');
	});

	test('maxAge is DEFERRED-ONLY: an island preset maxAge is ignored (no __cacheTtl on the island)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'cachedIsland' };`, '<C />'),
			makeCtx({ presets: { cachedIsland: { wake: 'load', maxAge: '5m' } } })
		)!;
		expect(r.islands[0].wrapperSource).toContain('__mode="island"');
		expect(r.islands[0].wrapperSource).not.toContain('__cacheTtl'); // inline islands don't cache
	});

	test('idle / visible / media strategies bake into wrapper', () => {
		const cases: Array<[string, RegExp]> = [
			['idle', /OgygiaRegion__Wrapper __mode="island" idle /],
			['visible', /OgygiaRegion__Wrapper __mode="island" visible="0px"/],
			['(min-width: 768px)', /OgygiaRegion__Wrapper __mode="island" media="\(min-width: 768px\)"/]
		];
		for (const [val, re] of cases) {
			const r = run(wrap(`import C from './C.svelte' with { wake: '${val}' };`, '<C />'))!;
			expect(r.islands[0].wrapperSource).toMatch(re);
		}
	});

	test('svelte:component this={C} is allowed', () => {
		const r = run(wrap(LOAD, '<svelte:component this={C} start={1} />'))!;
		expect(r.islands).toHaveLength(1);
		expect(r.code).toMatch(/svelte:component this=\{C\}/);
	});

	test('list + each of binding is allowed', () => {
		const r = run(
			wrap(
				`${LOAD}\nconst list = [{ comp: C, props: { n: 1 } }];`,
				'{#each list as item}<svelte:component this={item.comp} {...item.props} />{/each}'
			)
		)!;
		expect(r.islands).toHaveLength(1);
		expect(r.code).toMatch(/item\.comp/);
	});

	test('two static usages + dynamic + second import same path → ONE island entry', () => {
		const r = run(
			wrap(
				dedent`
					import A from './A.svelte' with { wake: 'load' };
					import B from './A.svelte' with { wake: 'load' };
					const dyn = A;
				`,
				'<A n={1} /><A n={2} /><svelte:component this={dyn} n={3} /><B n={4} />'
			)
		)!;
		expect(r.islands).toHaveLength(1);
		const iid = idFor('src/routes/A.svelte', loadMark);
		expect(r.islands[0].id).toBe(iid);
		expect(r.code).toMatch(/import A from/);
		expect(r.code).toMatch(/import B from/);
		expect(r.code).toContain(regionBindingVirtualId(iid));
		expect(r.islands[0].wrapperPath).toBe(wrapperVirtualId(iid));
	});

	test('csr=false client omit: many marked imports → stub bindings, still one emit metadata', () => {
		const imports = Array.from(
			{ length: 20 },
			(_, i) => `import C${i} from './A.svelte' with { wake: 'load' };`
		).join('\n');
		const markup = Array.from({ length: 20 }, (_, i) => `<C${i} n={${i}} />`).join('');
		// DEV leg: the fouc-css link is the only way component CSS reaches a csr=false page there.
		const r = run(wrap(imports, markup), makeCtx({ linkVirtualIsland: false, dev: true }))!;
		expect(r.islands).toHaveLength(1);
		expect(r.code).not.toMatch(/ogygia:region\/wrapper\//);
		expect(r.code).not.toMatch(/ogygia:region\/entry\//);
		expect(r.code.match(new RegExp(CLIENT_BINDING_STUB.replace(/\./g, '\\.'), 'g'))?.length).toBe(
			20
		);
		// FOUC: one deduped CSS-only virtual (not the component JS default export).
		expect(
			r.code.match(
				new RegExp(
					`import ["']ogygia:region/fouc-css/${encodeURIComponent('src/routes/A.svelte')}\\.js["'];`,
					'g'
				)
			)?.length
		).toBe(1);
		expect(r.code).not.toMatch(/import __OgygiaFouc_/);
		expect(r.code).not.toMatch(/from ["']\.\/A\.svelte["']/);
		expect(r.islands[0].wrapperPath).toBe(wrapperVirtualId(idFor('src/routes/A.svelte', loadMark)));
		expect(r.islands[0].virtualPath).toMatch(/^ogygia:region\/entry\//);
	});

	test('an empty client stub, or no wrapper path function, falls back to the built-in names', () => {
		const ctx = makeCtx({ linkVirtualIsland: false, clientBindingStub: '' });
		delete (ctx as { wrapperPathFor?: unknown }).wrapperPathFor;
		const r = run(wrap(`import C from './A.svelte' with { wake: 'load' };`, '<C />'), ctx)!;
		expect(r.code).toContain(CLIENT_BINDING_STUB);
		expect(r.islands[0].wrapperPath).toBe(wrapperVirtualId(idFor('src/routes/A.svelte', loadMark)));
	});

	test('csr=false client omit (DEV): CSS-only fouc-css virtual for FOUC (not component JS)', () => {
		const r = run(
			wrap(`import Nav from '$lib/SideNav.svelte' with { wake: 'load' };`, '<Nav />'),
			makeCtx({ linkVirtualIsland: false, dev: true })
		)!;
		expect(r.code).toContain(CLIENT_BINDING_STUB);
		expect(r.code).toContain(
			`import "ogygia:region/fouc-css/${encodeURIComponent('src/lib/SideNav.svelte')}.js";`
		);
		expect(r.code).not.toMatch(/from ["']\$lib\/SideNav\.svelte["']/);
		expect(r.code).not.toMatch(/ogygia:region\/wrapper\//);
	});

	// BUILD leg: no fouc-css link for an island. Kit would link the CSS of EVERY marked import the
	// host declares (rendered or not); Region.svelte links exactly the islands that render, from the
	// chunk closure. A page host importing 30 marked blocks and rendering 5 must not link 30 sheets.
	test('csr=false client omit (BUILD): island gets the stub and NO fouc-css link', () => {
		const r = run(
			wrap(`import Nav from '$lib/SideNav.svelte' with { wake: 'load' };`, '<Nav />'),
			makeCtx({ linkVirtualIsland: false, dev: false })
		)!;
		expect(r.code).toContain(CLIENT_BINDING_STUB);
		expect(r.code).not.toContain('ogygia:region/fouc-css/');
		expect(r.code).not.toMatch(/from ["']\$lib\/SideNav\.svelte["']/);
		expect(r.code).not.toMatch(/ogygia:region\/wrapper\//);
	});

	test('linkVirtualIsland true (default) rewrites to the attach binding (not the stub)', () => {
		const r = run(wrap(LOAD, '<C />'), makeCtx({ linkVirtualIsland: true }))!;
		expect(r.code).toContain(regionBindingVirtualId(idFor(C_REL, loadMark)));
		expect(r.code).not.toContain(CLIENT_BINDING_STUB);
	});

	test('same component different strategies → two entries', () => {
		const r = run(
			wrap(
				`import A from './A.svelte' with { wake: 'load' };\nimport ALazy from './A.svelte' with { wake: 'visible' };`,
				'<A /><ALazy />'
			)
		)!;
		expect(r.islands).toHaveLength(2);
		const ids = new Set(r.islands.map((i) => i.id));
		expect(ids.size).toBe(2);
	});

	test('cross-host identity: same component path yields same id', () => {
		const mark = loadMark;
		const host2 = '/app/src/routes/about/+page.svelte';
		const r1 = run(wrap(`import C from '$lib/C.svelte' with { wake: 'load' };`, '<C />'))!;
		const r2 = transformHost(
			wrap(`import C from '$lib/C.svelte' with { wake: 'load' };`, '<C />'),
			host2,
			makeCtx()
		)!;
		expect(r1.islands[0].id).toBe(r2.islands[0].id);
		expect(r1.islands[0].id).toBe(idFor('src/lib/C.svelte', mark));
	});

	test('unused marked import is stripped', () => {
		const r = run(wrap(LOAD, '<p>no usage of C</p>'))!;
		expect(r.islands).toHaveLength(0);
		expect(r.code).not.toMatch(/import C from/);
	});

	test('dotted Menu.Item on marked import is a build error', () => {
		expectThrows(
			() => run(wrap(`import Menu from './Menu.svelte' with { wake: 'load' };`, '<Menu.Item />')),
			/dotted tag/
		);
	});

	test('one marked declaration of two names becomes one binding import per name, in order', () => {
		const r = run(
			wrap(`import { A, B } from './ab.ts' with { wake: 'load' };`, '<A /><B />'),
			makeCtx({ linkVirtualIsland: false })
		)!;
		const [a, b] = ['A', 'B'].map((n) => r.code.indexOf(`import ${n} from`));
		expect(a).toBeGreaterThan(-1);
		expect(b).toBeGreaterThan(a);
	});

	test('a lake placed only as a dotted tag is used, so its import stays a lake', () => {
		const r = run(wrap(`import L from './L.svelte' with { wake: 'none' };`, '<L.Part />'))!;
		expect(r.islands.map((i) => i.kind)).toEqual(['lake']);
	});

	test('a plain import attribute beside a region import is left as written', () => {
		const json = `import data from './d.json' with { type: 'json' };`;
		const r = run(wrap(`${LOAD}\n${json}`, '<C n={data} />'))!;
		expect(r.islands).toHaveLength(1);
		expect(r.code).toContain(json);
	});

	test('a host whose <style> is SCSS still has its regions compiled', () => {
		const r = run(`${wrap(LOAD, '<C />')}\n<style lang="scss">$c: red; .a { color: $c; }</style>`)!;
		expect(r?.islands).toHaveLength(1);
	});

	test('island tags nested 26 deep are walked once, not once more per level', () => {
		const depth = 26;
		const markup = `${'<B>'.repeat(depth)}<C />${'</B>'.repeat(depth)}`;
		const t0 = performance.now();
		const r = run(wrap(`${LOAD}\nimport B from './B.svelte';`, markup))!;
		expect(r.islands).toHaveLength(1);
		expect(performance.now() - t0).toBeLessThan(2000);
	});
});

describe('defer / server islands', () => {
	test('defer:load → ServerIsland wrapper + defer entry', () => {
		const r = run(
			wrap(`import G from './G.svelte' with { render: 'deferred' };`, '<G name="w" />')
		)!;
		const iid = idFor('src/routes/G.svelte', {
			strategy: 'server',
			options: { when: 'load' }
		});
		expect(r.islands[0].id).toBe(iid);
		expect(r.islands[0].kind).toBe('defer');
		expect(r.islands[0].server).toBe(true);
		expect(r.islands[0].wrapperSource).toMatch(/OgygiaRegion__Wrapper __mode="server"/);
		expect(r.islands[0].wrapperSource).toMatch(/__defer=\{"load"\}/);
		expect(r.code).toMatch(/<G name="w"/);
	});

	test('ogygiaFallback snippet stays at call site', () => {
		const r = run(
			wrap(
				`import G from './G.svelte' with { render: 'deferred' };`,
				'<G>{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}</G>'
			)
		)!;
		expect(r.code).toMatch(/\{#snippet ogygiaFallback\(\)\}/);
		expect(r.islands[0].wrapperSource).toMatch(/ogygiaFallback/);
	});

	test('non-fallback children on defer are an error', () => {
		expectThrows(
			() => run(wrap(`import G from './G.svelte' with { render: 'deferred' };`, '<G><p>x</p></G>')),
			/host children/
		);
	});

	test('render: deferred is a hole, fetch its timing — content-only (never hydrates)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { render: 'deferred', fetch: 'idle' };`, '<C />')
		)!;
		expect(r.islands[0].kind).toBe('defer');
		expect(r.islands[0].server).toBe(true);
		expect(r.islands[0].wrapperSource).toMatch(/__defer=\{"idle"\}/);
		// content-only: no client hydrate module is emitted
		expect(r.islands[0].wrapperSource).not.toMatch(/__hydrate=/);
	});

	test("a hole's client wrapper never imports its component or entry (a hole ships no JS)", () => {
		const r = run(wrap(`import C from './C.svelte' with { render: 'deferred' };`, '<C />'))!;
		const hole = r.islands[0] as { wrapperSource: string; wrapperClientSource: string };
		expect(hole.wrapperSource).toContain('__OgygiaEntry');
		expect(hole.wrapperClientSource).not.toContain('__OgygiaEntry');
		expect(hole.wrapperClientSource).not.toContain('C.svelte');
	});

	test('a bare render: deferred is fetched on load, the same as fetch: load', () => {
		const a = run(wrap(`import C from './C.svelte' with { render: 'deferred' };`, '<C />'))!;
		const b = run(
			wrap(`import C from './C.svelte' with { render: 'deferred', fetch: 'load' };`, '<C />')
		)!;
		expect(a.islands[0].wrapperSource).toMatch(/__defer=\{"load"\}/);
		expect(a.islands[0].id).toBe(b.islands[0].id);
	});

	test('a hole must fetch (fetch: none is rejected)', () => {
		expectThrows(
			() =>
				run(
					wrap(`import G from './G.svelte' with { render: 'deferred', fetch: 'none' };`, '<G />')
				),
			/a hole must fetch/
		);
	});

	test('wake on a render: deferred import fails the build, naming the fetch to write', () => {
		expectThrows(
			() =>
				run(
					wrap(`import G from './G.svelte' with { render: 'deferred', wake: 'visible' };`, '<G />')
				),
			/ships no JS, so `wake` never applies[\s\S]*fetch: 'visible'[\s\S]*e\/hole_wake_removed/
		);
	});

	test('wake on a render: deferred preset fails the build too, naming the preset', () => {
		expectThrows(
			() =>
				run(
					wrap(`import G from './G.svelte' with { preset: 'later' };`, '<G />'),
					makeCtx({ presets: { later: { render: 'deferred', wake: 'idle' } } })
				),
			/preset 'later'[\s\S]*fetch: 'idle'[\s\S]*e\/hole_wake_removed/
		);
	});

	test('a hole with both fetch and wake fails on its wake', () => {
		expectThrows(
			() =>
				run(
					wrap(
						`import G from './G.svelte' with { render: 'deferred', fetch: 'idle', wake: 'visible' };`,
						'<G />'
					)
				),
			/e\/hole_wake_removed/
		);
	});

	test('fetch pairs with render: deferred — alone, or with another render, it is refused', () => {
		expectThrows(
			() => run(wrap(`import G from './G.svelte' with { fetch: 'visible' };`, '<G />')),
			/without `render: 'deferred'`.*Write `render: 'deferred', fetch: 'visible'` for a hole, or `wake: 'visible'` for an island/
		);
		expectThrows(
			() =>
				run(wrap(`import G from './G.svelte' with { render: 'live', fetch: 'load' };`, '<G />')),
			/`fetch` is a hole's timing/
		);
	});

	test('deferred is no-store by default (no __cacheTtl emitted)', () => {
		const r = run(wrap(`import C from './C.svelte' with { render: 'deferred' };`, '<C />'))!;
		expect(r.islands[0].wrapperSource).not.toMatch(/__cacheTtl/);
	});

	test('preset maxAge → __cacheTtl in seconds (duration string)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'cached' };`, '<C />'),
			makeCtx({ presets: { cached: { render: 'deferred', maxAge: '1h' } } })
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__cacheTtl=\{3600\}/);
	});

	test('preset maxAge → __cacheTtl in seconds (bare number is seconds)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'cached' };`, '<C />'),
			makeCtx({ presets: { cached: { render: 'deferred', maxAge: 45 } } })
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__cacheTtl=\{45\}/);
	});

	test('preset maxAge: 0 stays no-store (no __cacheTtl)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'fresh' };`, '<C />'),
			makeCtx({ presets: { fresh: { render: 'deferred', maxAge: 0 } } })
		)!;
		expect(r.islands[0].wrapperSource).not.toMatch(/__cacheTtl/);
	});
});

// PREFETCH — a hole warms its HTML on an EARLIER schedule than its `fetch` (the swap).
// The on-demand case: `fetch: 'interaction', prefetch: 'idle'` — bytes in the frame store before
// the first hover, the gesture joins the warm frame. Rides inline or in a preset; holes only;
// never 'interaction' (that is the swap) and never the hole's own `fetch` (adds nothing).
describe('deferred `prefetch` (the warm schedule)', () => {
	test('inline: prefetch: idle on an interaction hole → __prefetch on the wrapper, when stays interaction', () => {
		const r = run(
			wrap(
				`import C from './C.svelte' with { render: 'deferred', fetch: 'interaction', prefetch: 'idle' };`,
				'<C />'
			)
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__defer=\{"interaction"\}/);
		expect(r.islands[0].wrapperSource).toMatch(/__prefetch=\{"idle"\}/);
	});

	test('preset: the same, with maxAge alongside', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'menu' };`, '<C />'),
			makeCtx({
				presets: {
					menu: { render: 'deferred', fetch: 'interaction', prefetch: 'idle', maxAge: '1h' }
				}
			})
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__prefetch=\{"idle"\}/);
		expect(r.islands[0].wrapperSource).toMatch(/__cacheTtl=\{3600\}/);
	});

	test('prefetch: visible carries the margin (its IntersectionObserver lead), a media query is a schedule too', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'menu' };`, '<C />'),
			makeCtx({
				presets: {
					menu: { render: 'deferred', fetch: 'interaction', prefetch: 'visible', margin: '300px' }
				}
			})
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__prefetch=\{"visible"\}/);
		expect(r.islands[0].wrapperSource).toMatch(/__margin=\{"300px"\}/);
		const m = run(
			wrap(
				`import C from './C.svelte' with { render: 'deferred', fetch: 'interaction', prefetch: '(min-width: 900px)' };`,
				'<C />'
			)
		)!;
		expect(m.islands[0].wrapperSource).toMatch(/__prefetch=\{"\(min-width: 900px\)"\}/);
	});

	test('no prefetch → no __prefetch (the default is the hover warm an interaction hole already has)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { render: 'deferred', fetch: 'interaction' };`, '<C />')
		)!;
		expect(r.islands[0].wrapperSource).not.toMatch(/__prefetch/);
	});

	test("prefetch: 'interaction' is refused — that is the swap, fetch's job", () => {
		expect(() =>
			run(
				wrap(
					`import C from './C.svelte' with { render: 'deferred', fetch: 'load', prefetch: 'interaction' };`,
					'<C />'
				)
			)
		).toThrow(/Never 'interaction'/);
	});

	test('prefetch equal to the fetch schedule is refused — it adds nothing', () => {
		expect(() =>
			run(
				wrap(
					`import C from './C.svelte' with { render: 'deferred', fetch: 'idle', prefetch: 'idle' };`,
					'<C />'
				)
			)
		).toThrow(/adds nothing/);
	});

	test('prefetch without render: deferred is refused (an island has modulepreload hints for its JS)', () => {
		expect(() =>
			run(wrap(`import C from './C.svelte' with { wake: 'visible', prefetch: 'idle' };`, '<C />'))
		).toThrow(/only valid with `render: 'deferred'`/);
	});

	test('an unknown prefetch value is refused with the vocabulary', () => {
		expect(() =>
			run(
				wrap(
					`import C from './C.svelte' with { render: 'deferred', fetch: 'interaction', prefetch: 'hover' };`,
					'<C />'
				)
			)
		).toThrow(/'load' \| 'idle' \| 'visible' \| a media query/);
	});

	test('identity: the same component with and without a prefetch are two wrappers, not one', () => {
		const a = idFor('src/lib/C.svelte', { strategy: 'server', options: { when: 'interaction' } });
		const b = idFor('src/lib/C.svelte', {
			strategy: 'server',
			options: { when: 'interaction', prefetch: 'idle' }
		});
		expect(a).not.toBe(b);
	});
});

describe('lakes', () => {
	test('hydrate:none → lake wrapper binding', () => {
		const r = run(wrap(`import L from './L.svelte' with { wake: 'none' };`, '<L />'))!;
		expect(r.islands).toHaveLength(1);
		expect(r.islands[0].kind).toBe('lake');
		expect(r.islands[0].wrapperSource).toMatch(/OgygiaRegion__Wrapper __mode="lake"/);
		expect(r.islands[0].wrapperSource).toMatch(/OgygiaLakeInner/);
		expect(r.islands[0].lakes).toEqual(['OgygiaLakeInner']);
		expect(r.code).toMatch(/ogygia:region\/wrapper\//);
	});

	// Regression: a lake's inner is client-stubbed to render-nothing on EVERY client leg, so its
	// scoped CSS never rides the binding — it must always get the fouc-css side-effect link on a
	// client build, INCLUDING the real-wrapper leg (linkVirtualIsland: true) a layout that also
	// serves a csr=true page is forced onto. That leg once skipped it and the lake shipped unstyled.
	const L_FOUC = foucCssVirtualId('src/routes/L.svelte');
	test('lake on the real-wrapper client leg (linkVirtualIsland: true) still links its CSS (fouc-css)', () => {
		const r = run(
			wrap(`import L from './L.svelte' with { wake: 'none' };`, '<L />'),
			makeCtx({ linkVirtualIsland: true, ssr: false })
		)!;
		// real wrapper (this leg can hydrate under a csr=true child) AND the CSS link.
		expect(r.code).toMatch(/ogygia:region\/wrapper\//);
		expect(r.code).toContain(L_FOUC);
	});

	test('lake on the stub client leg (linkVirtualIsland: false) links its CSS too', () => {
		const r = run(
			wrap(`import L from './L.svelte' with { wake: 'none' };`, '<L />'),
			makeCtx({ linkVirtualIsland: false, ssr: false })
		)!;
		expect(r.code).toContain(L_FOUC);
	});

	test('lake on the SSR build does NOT link fouc-css (the real component renders + collects CSS)', () => {
		const r = run(
			wrap(`import L from './L.svelte' with { wake: 'none' };`, '<L />'),
			makeCtx({ linkVirtualIsland: true, ssr: true })
		)!;
		expect(r.code).not.toContain('ogygia:region/fouc-css/');
	});

	test('a cached lake is its wrapper alone; a live (swr) lake also gets a server entry', () => {
		const cached = run(wrap(`import L from './L.svelte' with { wake: 'none' };`, '<L />'))!;
		expect(cached.islands[0]).toMatchObject({ virtualPath: undefined, source: undefined });
		const live = run(wrap(`import L from './L.svelte' with { render: 'live' };`, '<L />'))!;
		expect(live.islands[0].virtualPath).toMatch(/^ogygia:region\/entry\//);
		expect(live.islands[0].source).toMatch(/L\.svelte/);
	});

	test('render: live gets a server entry module (baked + revalidate)', () => {
		const r = run(
			wrap(`import L from './L.svelte' with { preset: 'liveBox' };`, '<L />'),
			makeCtx({
				presets: { liveBox: { render: 'live' } }
			})
		)!;
		expect(r.islands[0].server).toBe(true);
		expect(r.islands[0].virtualPath).toMatch(/ogygia:region\/entry\//);
		expect(r.islands[0].source).toMatch(/export default __OgygiaComp_/);
	});

	test('render: live with children is an error (revalidate endpoint re-renders from props)', () => {
		expectThrows(
			() => run(wrap(`import L from './L.svelte' with { render: 'live' };`, '<L><p>x</p></L>')),
			/cannot have children/
		);
	});
});

describe('presets', () => {
	test('preset expands to strategy on wrapper', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { preset: 'lazy' };`, '<C />'),
			makeCtx({ presets: { lazy: { wake: 'visible', margin: '200px' } } })
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/visible="200px"/);
	});
});

describe('errors', () => {
	test("wake: 'false' suggests none", () => {
		expectThrows(
			() => run(wrap(`import C from './C.svelte' with { wake: 'false' };`, '<C />')),
			/wake: 'false'.*wake: 'none'/i
		);
	});
	test('unknown strategy', () => {
		expectThrows(
			() => run(wrap(`import C from './C.svelte' with { wake: 'sometimes' };`, '<C />')),
			/unknown wake strategy/
		);
	});
	test("render: 'static' alone marks nothing: the build says so, never leaves the attribute in", () => {
		expectThrows(
			() => run(wrap(`import C from './C.svelte' with { render: 'static' };`, '<C />')),
			/render: 'static'.*marks nothing/
		);
	});
	test('keep on a hole, a lake or a live region (no island to keep) is refused, not dropped', () => {
		for (const mark of [
			`render: 'deferred', keep: 'k'`,
			`wake: 'none', keep: 'k'`,
			`render: 'live', keep: 'k'`
		])
			expectThrows(
				() => run(wrap(`import C from './C.svelte' with { ${mark} };`, '<C />')),
				/`keep`.*waking island/
			);
	});
	test("inline stitch takes the strings 'serve' or 'edge' only", () => {
		expectThrows(
			() =>
				run(
					wrap(`import C from './C.svelte' with { render: 'deferred', stitch: 'true' };`, '<C />')
				),
			/stitch: 'true'.*stitch: 'serve'.*stitch: 'edge'/
		);
	});
	test('a file that names asRegion is read even with no region key in it, and refused', () => {
		expectThrows(
			() =>
				run(
					wrap(`import H from './H.svelte';\nconst X = import.meta.og.asRegion(H, {});`, '<X />')
				),
			/asRegion/
		);
	});
	test("a wake that looks like a call ('visible(200px)') is no media query: refused", () => {
		expectThrows(
			() => run(wrap(`import C from './C.svelte' with { wake: 'visible(200px)' };`, '<C />')),
			/unknown wake strategy 'visible\(200px\)'/
		);
	});
	test('dynamic import with region keys', () => {
		expectThrows(
			() =>
				run(
					wrap(
						`async function go() { await import('./C.svelte', { with: { wake: 'load' } }); }`,
						''
					)
				),
			/dynamic import\(\) with/
		);
	});
});

describe('entry module shape', () => {
	test('entry is a JS re-export of the component (props stay on the host tag)', () => {
		const r = run(wrap(`${LOAD}\nlet n = 1;`, '<C start={n} />'))!;
		expect(r.islands[0].source).toMatch(
			new RegExp(
				`import __OgygiaComp_${r.islands[0].id} from ${JSON.stringify('/app/src/routes/C.svelte').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
			)
		);
		expect(r.islands[0].source).toMatch(`export default __OgygiaComp_${r.islands[0].id};`);
		expect(r.code).toMatch(/<C start=\{n\}/);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-island children — host children cross a hydrate island at RUNTIME, not compile time.
// The compiler leaves the call site alone: children stay in the host markup and flow through the
// wrapper into Region's slot; the server renders them IN-PLACE inside a `<ogygia-slot>` marker and
// the payload carries a slot POINTER the client revives into an adopting snippet (region-snippet.ts).
// Nested islands inside render as full regions (SlotBoundary resets the nested context) and wake
// independently. This suite guards that the compiler does NOTHING special for children.
// ─────────────────────────────────────────────────────────────────────────────
describe('cross-island children (runtime slot crossing)', () => {
	const entryOf = (r: Result) => r.islands[0]?.virtualPath ?? '';
	const synthOf = (r: Result) => r.islands[0]?.source ?? '';

	test('children stay at the call site; the entry is the plain .js re-export', () => {
		const r = run(wrap(LOAD, '<C><p>x</p></C>'))!;
		expect(entryOf(r)).toMatch(/\.js$/);
		expect(synthOf(r)).toMatch(/export default __OgygiaComp_/);
		// the host tag keeps its children — the wrapper forwards them into Region's slot
		expect(r.code).toMatch(/<C\s*><p>x<\/p><\/C>/);
	});

	test('a plain island (no children) compiles identically', () => {
		const r = run(wrap(LOAD, '<C />'))!;
		expect(entryOf(r)).toMatch(/\.js$/);
		expect(synthOf(r)).toMatch(/export default __OgygiaComp_/);
	});

	test('children do not change the region id — one island either way', () => {
		const withKids = run(wrap(LOAD, '<C><p>x</p></C>'))!;
		const noKids = run(wrap(LOAD, '<C />'))!;
		expect(withKids.islands).toHaveLength(1);
		expect(withKids.islands[0].id).toBe(noKids.islands[0].id);
	});

	test('many call sites with different children share the ONE island', () => {
		const r = run(
			wrap(
				LOAD,
				dedent`
			<C><p>a</p></C>
			<C><p>b</p></C>
			<C><p>a</p></C>
		`
			)
		)!;
		expect(r.islands).toHaveLength(1);
		// no synthetic per-usage bindings — every usage keeps the real import
		expect(r.code).not.toMatch(/__og\d/);
	});

	test('host values referenced by children need no capture wiring (server closure renders them)', () => {
		const r = run(wrap(`${LOAD}\nconst who = "Ada";`, '<C><p>{who}</p></C>'))!;
		expect(r.code).not.toMatch(/__ogFv/);
		expect(r.code).toMatch(/<p>\{who\}<\/p>/);
	});

	test('a nested marked island inside children keeps its OWN region (wakes independently)', () => {
		const r = run(
			wrap(`${LOAD}\nimport B from './B.svelte' with { wake: 'load' };`, '<C><B start={5} /></C>')
		)!;
		expect(r.islands).toHaveLength(2);
		expect(r.code).toMatch(/<B start=\{5\} \/>/);
	});

	test('a server island still rejects host children (only the fallback snippet crosses)', () => {
		expectThrows(
			() => run(wrap(`import G from './G.svelte' with { render: 'deferred' };`, '<G><p>x</p></G>')),
			/host children\/snippets/
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// wake: 'interaction' — wake on first pointer/key/focus inside the region, click replay.
// ─────────────────────────────────────────────────────────────────────────────
describe('interaction schedule', () => {
	test("wake: 'interaction' → wrapper attr + region kind hydrate", () => {
		const r = run(wrap(`import C from './C.svelte' with { wake: 'interaction' };`, '<C />'))!;
		expect(r.islands).toHaveLength(1);
		expect(r.islands[0].kind).toBe('hydrate');
		expect(r.islands[0].wrapperSource).toMatch(
			/OgygiaRegion__Wrapper __mode="island" interaction /
		);
	});

	test('interaction dedupes by path+strategy like any schedule', () => {
		const a = run(wrap(`import C from './C.svelte' with { wake: 'interaction' };`, '<C />'))!;
		const b = run(wrap(`import C from './C.svelte' with { wake: 'interaction' };`, '<C />'))!;
		const load = run(wrap(LOAD, '<C />'))!;
		expect(a.islands[0].id).toBe(b.islands[0].id);
		expect(a.islands[0].id).not.toBe(load.islands[0].id);
	});

	test('preset with hydrate: interaction works', () => {
		const ctx = makeCtx({ presets: { lazy: { wake: 'interaction' } } });
		const r = run(wrap(`import C from './C.svelte' with { preset: 'lazy' };`, '<C />'), ctx)!;
		expect(r.islands[0].wrapperSource).toMatch(
			/OgygiaRegion__Wrapper __mode="island" interaction /
		);
	});

	test("render: deferred + fetch: 'interaction' is an ON-DEMAND hole (fetch on intent)", () => {
		const r = run(
			wrap(`import G from './G.svelte' with { render: 'deferred', fetch: 'interaction' };`, '<G />')
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__mode="server"/);
		expect(r.islands[0].wrapperSource).toMatch(/__defer=\{?"interaction"\}?/);
		expect(r.islands[0].wrapperSource).not.toMatch(/__margin/);
	});

	test("render: deferred + fetch: 'none' is rejected (a hole must fetch)", () => {
		expectThrows(
			() =>
				run(
					wrap(`import G from './G.svelte' with { render: 'deferred', fetch: 'none' };`, '<G />')
				),
			/a hole must fetch/
		);
	});

	test('interaction island can carry crossed children (runtime slot, plain entry)', () => {
		const r = run(
			wrap(`import C from './C.svelte' with { wake: 'interaction' };`, '<C><p>x</p></C>')
		)!;
		expect(r.islands[0].virtualPath).toMatch(/\.js$/);
		expect(r.islands[0].wrapperSource).toMatch(
			/OgygiaRegion__Wrapper __mode="island" interaction /
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// continuity: keep — `with { keep: 'name' }` keeps the live island across SPA nav.
// ─────────────────────────────────────────────────────────────────────────────
describe('keep attribute', () => {
	test('hydrate + keep → wrapper passes __keep', () => {
		const r = run(
			wrap(`import P from './P.svelte' with { wake: 'load', keep: 'player' };`, '<P />')
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__keep=\{"player"\}/);
		// keep rides on the hydrate strategy (still a load island)
		expect(r.islands[0].wrapperSource).toMatch(/OgygiaRegion__Wrapper __mode="island" load/);
	});

	test('keep alone (default load schedule) is allowed', () => {
		const r = run(
			wrap(`import P from './P.svelte' with { wake: 'visible', keep: 'x' };`, '<P />')
		)!;
		expect(r.islands[0].wrapperSource).toMatch(/__keep=\{"x"\}/);
		expect(r.islands[0].wrapperSource).toMatch(/OgygiaRegion__Wrapper __mode="island" visible/);
	});

	test('empty keep name is a build error', () => {
		expectThrows(
			() => run(wrap(`import P from './P.svelte' with { wake: 'load', keep: '' };`, '<P />')),
			/keep.*non-empty name/
		);
	});

	test('keep in a preset works', () => {
		const ctx = makeCtx({ presets: { pl: { wake: 'load', keep: 'player' } } });
		const r = run(wrap(`import P from './P.svelte' with { preset: 'pl' };`, '<P />'), ctx)!;
		expect(r.islands[0].wrapperSource).toMatch(/__keep=\{"player"\}/);
	});
});

describe('portable snippets — a named snippet handed to a non-island component', () => {
	const portableIslands = (r: Result) =>
		r.islands.filter((i) => (i as { portable?: boolean }).portable);

	test('is rewritten to og_portable + emits a hydrate entry', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';`,
				`<Shell>{#snippet actions()}<a href="#">GH</a>{/snippet}</Shell>`
			)
		)!;
		expect(r.code).toMatch(/og_portable/);
		expect(r.code).toMatch(/actions=\{__og_portable\(/);
		expect(portableIslands(r).length).toBe(1);
	});

	test('captured host value is passed to the entry as a prop', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';\nconst who = 'Ada';`,
				`<Shell>{#snippet actions()}<a>{who}</a>{/snippet}</Shell>`
			)
		)!;
		// og_portable receives { who } and the entry destructures it.
		expect(r.code).toMatch(/__og_portable\(\s*[^,]+,\s*[^,]+,\s*\{ who \}/);
		expect(portableIslands(r)[0].source).toMatch(/let \{ who \} = \$props\(\)/);
	});

	test('two identical snippets dedupe to ONE entry + ONE import', () => {
		const src = wrap(
			`import Shell from './Shell.svelte';`,
			`<Shell>{#snippet a()}<a>x</a>{/snippet}</Shell>\n<Shell>{#snippet b()}<a>x</a>{/snippet}</Shell>`
		);
		const r = run(src, makeCtx({ ssr: true }))!;
		expect(portableIslands(r).length).toBe(1);
		expect((r.code.match(/import __OgPS_/g) || []).length).toBe(1);
	});

	test('SSR emits a static entry import; the csr=false client loads by url', () => {
		const src = wrap(
			`import Shell from './Shell.svelte';`,
			`<Shell>{#snippet actions()}<a>x</a>{/snippet}</Shell>`
		);
		const ssr = run(src, makeCtx({ ssr: true }))!;
		expect(ssr.code).toMatch(/import __OgPS_[a-f0-9]+ from/);
		expect(ssr.code).toMatch(/__og_portable\(__og_native_actions_0, __OgPS_/);
		const client = run(src, makeCtx({ ssr: false }))!;
		expect(client.code).not.toMatch(/import __OgPS_/);
		expect(client.code).toMatch(/__og_portable\(__og_native_actions_0, null,/);
	});

	// IN PLACE: the snippet as written stays in the host (moved to the template root under a private
	// name) and is what the component renders — the host's context and scoped CSS reach it. The
	// component receives it branded; only a boundary swaps in the portable entry.
	test('the snippet as written stays in the host, at the root, and is what the component gets', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';\nconst who = 'Ada';`,
				`<Shell>{#snippet actions()}<a class="x">{who}</a>{/snippet}</Shell>`
			),
			makeCtx({ ssr: true })
		)!;
		expect(r.code).toMatch(/<Shell actions=\{__og_portable\(__og_native_actions_0,/);
		expect(r.code).toMatch(
			/\{#snippet __og_native_actions_0\(\)\}<a class="x">\{who\}<\/a>\{\/snippet\}\s*$/
		);
		expect(r.code).not.toMatch(/<Shell[^>]*>\s*\{#snippet/);
	});

	test('a body bound to an enclosing block ({#each} item, {@const}) stays a plain snippet', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';\nconst rows = [1, 2];`,
				`{#each rows as row}<Shell>{#snippet actions()}<a>{row}</a>{/snippet}</Shell>{/each}`
			)
		);
		expect(r?.code ?? '').not.toMatch(/og_portable/);
		expect(r ? portableIslands(r).length : 0).toBe(0);
	});

	test('a parameterized snippet on a PLAIN component stays native (library-internal wiring)', () => {
		// Branding isolates the snippet body from the surrounding tree (getContext breaks) — think
		// Bits UI passing `{#snippet x(props)}` between its own context-coupled components.
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';`,
				`<Shell>{#snippet row(item)}<li>{item}</li>{/snippet}</Shell>`
			)
		);
		expect(r?.code ?? '').not.toMatch(/og_portable/);
	});

	test('a parameterized snippet at an ISLAND call site compiles portable — args ride __ogArgs', () => {
		const r = run(wrap(LOAD, `<C>{#snippet row(item)}<li>{item}</li>{/snippet}</C>`))!;
		expect(r.code).toMatch(/row=\{__og_portable\(/);
		const entry = r.islands.find((i) => (i as { portable?: boolean }).portable)!;
		// the entry re-binds the params from the __ogArgs prop; `item` is never a capture
		expect(entry.source).toMatch(/let \{ __ogArgs = \[\] \} = \$props\(\);/);
		expect(entry.source).toMatch(/const \[item\] = __ogArgs;/);
	});

	test('node_modules-swept sources are never portable-branded (bits-ui safety)', () => {
		const src = wrap(
			`import Shell from './Shell.svelte';`,
			`<Shell>{#snippet header()}<em>x</em>{/snippet}</Shell>`
		);
		const r = transformHost(src, '/app/node_modules/some-lib/dist/Widget.svelte', makeCtx());
		expect(r?.code ?? '').not.toMatch(/og_portable/);
	});

	test('a snippet that writes host state is left native (a snapshot can’t write back)', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';\nlet count = $state(0);`,
				`<Shell>{#snippet actions()}<button onclick={() => count++}>{count}</button>{/snippet}</Shell>`
			)
		);
		expect(r?.code ?? '').not.toMatch(/og_portable/);
	});

	test('a named snippet handed to an ISLAND call site compiles portable too (live crossing)', () => {
		const r = run(wrap(LOAD, `<C>{#snippet actions()}<a>x</a>{/snippet}</C>`))!;
		expect(r.code).toMatch(/actions=\{__og_portable\(/);
		// the island itself + the portable entry
		expect(r.islands.length).toBe(2);
	});

	test('SSR emits NO static modulepreload — the hint is render-gated in Region.svelte', () => {
		// The old static scan preloaded every portable CANDIDATE in the host, rendered or not (an
		// opted-out snippet still cost a head link + fetch). The no-waterfall hint now comes from
		// Region.svelte when an island's props actually carry the descriptor. The transform's job
		// is only to thread the public entry url through og_portable for that render-time emission.
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';`,
				`<Shell>{#snippet actions()}<a>x</a>{/snippet}</Shell>`
			),
			makeCtx({ ssr: true })
		)!;
		expect(r.code).not.toMatch(/<svelte:head><link rel="modulepreload"/);
		expect(r.code).toMatch(/__og_portable\([^)]*"\/_app\/ogygia\/og-region\.[a-f0-9]+\.js"\)/);
	});

	test('a snippet nested in another crossing snippet ships inside the outer entry, not as its own', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';`,
				`<Shell>{#snippet outer()}<Shell>{#snippet inner()}<b>x</b>{/snippet}</Shell>{/snippet}</Shell>`
			)
		)!;
		expect(portableIslands(r)).toHaveLength(1);
		expect(portableIslands(r)[0].source).toContain('{#snippet inner()}');
	});

	test('a snippet that reassigns only its own parameter still crosses', () => {
		const r = run(
			wrap(
				`import Box from './Box.svelte' with { wake: 'load' };`,
				`<Box>{#snippet row(n)}<button onclick={() => (n = n + 1)}>{n}</button>{/snippet}</Box>`
			)
		)!;
		expect(portableIslands(r)).toHaveLength(1);
	});

	test('two names from one <script module> import are imported once in the synth', () => {
		const r = run(
			dedent`
				<script module>
					import { a, b } from './ab.ts';
				</script>
				<script>
					import Shell from './Shell.svelte';
				</script>
				<Shell>{#snippet actions()}<a>{a}{b}</a>{/snippet}</Shell>
			`
		)!;
		const synth = portableIslands(r)[0].source!;
		expect(synth.split(`import { a, b } from './ab.ts';`)).toHaveLength(2);
	});

	test("a declared package's host keys its snippet entries by package, not by install path", () => {
		const src = wrap(
			`import Shell from './Shell.svelte';`,
			`<Shell>{#snippet actions()}<a>x</a>{/snippet}</Shell>`
		);
		const at = (dir: string) =>
			transformHost(
				src,
				`${dir}/src/Page.svelte`,
				makeCtx({
					pkg_identity: (p: string) => (p.startsWith(dir) ? `pkg${p.slice(dir.length)}` : null)
				})
			)!;
		const one = portableIslands(at('/store/pkg@1/pkg'));
		const two = portableIslands(at('/store/pkg@2/pkg'));
		expect(one[0].id).toBe(two[0].id);
	});

	test('a host with only a <script module> gains one instance <script> for the helper', () => {
		const r = run(
			dedent`
				<script module>
					import Shell from './Shell.svelte';
				</script>
				<Shell>{#snippet actions()}<a>x</a>{/snippet}</Shell>
			`
		)!;
		expect(r.code.match(/<script>/g)).toHaveLength(1);
		expect(r.code).toMatch(/<script>\s*import \{ og_portable as __og_portable \}/);
	});

	test('a root snippet handed to nothing leaves the file untouched (null)', () => {
		expect(run(`{#snippet a()}<b>x</b>{/snippet}<Shell />`)).toBeNull();
	});

	test('a snippet-only file with no islands still transforms (relaxed bailout)', () => {
		const r = run(
			wrap(
				`import Shell from './Shell.svelte';`,
				`<Shell>{#snippet actions()}<a>x</a>{/snippet}</Shell>`
			)
		);
		expect(r).not.toBeNull();
	});
});

describe('package-specifier island marks', () => {
	const PKG = `import TabGroup from 'ogygia/content/tab-group' with { wake: 'load' };`;
	const PKG_SPEC = 'ogygia/content/tab-group';

	test('a marked package import (no children) becomes an island keyed by the specifier', () => {
		const r = run(wrap(PKG, '<TabGroup />'))!;
		expect(r.islands).toHaveLength(1);
		const isl = r.islands[0];
		// identity IS the verbatim specifier (stable + shared across hosts), not a root-relative path
		expect(isl.id).toBe(idFor(PKG_SPEC, loadMark));
		expect(isl.componentPath).toBe(PKG_SPEC);
		// generated entry + wrapper RE-EMIT the original specifier for Vite to resolve
		expect(isl.source).toContain(`from "${PKG_SPEC}"`);
		expect(isl.wrapperSource).toContain(`from "${PKG_SPEC}"`);
	});

	test('children at the call site stay put — the package island crosses them at runtime', () => {
		const src = wrap(
			`${PKG}\nimport { Tab } from 'ogygia/content';`,
			`<TabGroup group="install"><Tab label="npm"><p>x</p></Tab></TabGroup>`
		);
		const r = run(src)!;
		expect(r.islands).toHaveLength(1);
		const isl = r.islands[0];
		// plain .js re-export entry — no synthesized wrapper component
		expect(isl.virtualPath).toMatch(/\.js$/);
		expect(isl.source).toContain(`from "${PKG_SPEC}"`);
		// host tag untouched: real import name, children in place (they flow through the wrapper's slot)
		expect(r.code).toMatch(
			/<TabGroup group="install"><Tab label="npm"><p>x<\/p><\/Tab><\/TabGroup>/
		);
		expect(r.code).not.toMatch(/__og\d/);
		// the plain named package import (Tab) rides along untouched
		expect(r.code).toContain(`import { Tab } from 'ogygia/content';`);
	});

	test('two hosts marking the same package specifier share one region id', () => {
		const a = transformHost(
			wrap(PKG, '<TabGroup />'),
			'/app/src/routes/a/+page.svelte',
			makeCtx()
		)!;
		const b = transformHost(
			wrap(PKG, '<TabGroup />'),
			'/app/src/routes/deep/b/+page.svelte',
			makeCtx()
		)!;
		expect(a.islands[0].id).toBe(b.islands[0].id);
	});

	test('package islands with children share one id across hosts (children no longer key the id)', () => {
		const src = (host: string) =>
			transformHost(
				wrap(
					`${PKG}\nimport { Tab } from 'ogygia/content';`,
					`<TabGroup group="pm"><Tab label="npm"><p>i</p></Tab></TabGroup>`
				),
				host,
				makeCtx()
			)!;
		const a = src('/app/src/content/one.md');
		const b = src('/app/src/content/two.md');
		expect(a.islands[0].id).toBe(b.islands[0].id);
	});

	test('csr=false client host: package island skips the fouc-css side-effect import (needs a real path)', () => {
		const r = transformHost(
			wrap(PKG, '<TabGroup />'),
			HOST,
			makeCtx({ linkVirtualIsland: false, dev: true })
		)!;
		expect(r.code).toContain(CLIENT_BINDING_STUB);
		expect(r.code).not.toContain('ogygia:region/fouc-css');
		// a relative island on the same host still gets its fouc-css import (dev leg)
		const rel = run(wrap(LOAD, '<C />'), makeCtx({ linkVirtualIsland: false, dev: true }))!;
		expect(rel.code).toContain(foucCssVirtualId(C_REL));
	});

	test('an empty specifier still errors loudly', () => {
		expectThrows(
			() => run(wrap(`import X from '' with { wake: 'load' };`, '<X />')),
			/needs a module specifier/
		);
	});
});
