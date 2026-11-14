// Region transform suite for `.ts` registries / remotes. Two markers:
//   - `with { region: 'raw' }` → a bare HELD descriptor (server:true, no baked schedule) handed to
//     `region()`. `.svelte` `region: 'raw'` produces the same descriptor.
//   - `with { wake: '…' }` → a HELD binding that is ALSO MOUNTABLE (server:true + held, kind:'hydrate'):
//     placeable via `<svelte:component>` (renders the `<ogygia-region>` shell, JS gated on placement +
//     schedule) yet still crossable over the wire via `region()`. A superset of the old descriptor. It
//     keeps the `held:*` identity — distinct from a `.svelte` PLACED island (`hydrate:*`, no endpoint).
// Both rewrite the host import to the leg-split binding module.

import { describe, test, expect } from 'vitest';
import {
	transformHost,
	transformTsRegions,
	regionIdentity,
	regionId,
	regionBindingVirtualId
} from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

const ROOT = '/app';

type HostCtx = Parameters<typeof transformHost>[2];

function makeCtx(overrides: Partial<HostCtx> = {}): HostCtx {
	return {
		...HOST_CTX_DEFAULTS,
		root: ROOT,
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_hostId: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_hostId: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		...overrides
	};
}

// A `.ts` held-region id: strategy 'held', its baked schedule → `region:raw` (no schedule) vs
// `region:visible`. A `.ts` `wake:` mark bakes the schedule but stays a HELD (crossable) island, so it
// keeps the `held:*` identity — distinct from a `.svelte` PLACED island (`hydrate:*`, no endpoint).
function heldId(compRel: string, hydrate?: string) {
	const options: Record<string, unknown> = {};
	if (hydrate) {
		options.hydrate = hydrate;
		if (hydrate === 'visible') options.hydrateMargin = '0px';
	}
	return regionId(regionIdentity(compRel, { strategy: 'held', options }));
}

describe('transformHost — held region in .svelte (region: raw)', () => {
	const src = `<script>
		import Card from '$lib/Card.svelte' with { region: 'raw' };
		import { region } from 'ogygia';
		export const f = region(Card, { id: 1 });
	</script>`;

	test('registers a server descriptor and rewrites the import to the binding module', () => {
		const r = transformHost(src, '/app/src/routes/+page.svelte', makeCtx());
		expect(r).not.toBeNull();
		const iid = heldId('src/lib/Card.svelte');
		expect(r!.islands).toHaveLength(1);
		const isl = r!.islands[0];
		expect(isl.id).toBe(iid);
		expect(isl.server).toBe(true);
		expect(isl.kind).toBe('hydrate');
		expect(isl.held).toBe(true);
		expect(isl.bindingPath).toBe(regionBindingVirtualId(iid));
		expect(String(isl.bindingSsrSource)).toContain('make_region_endpoint');
		// region:'raw' bakes NO schedule — the descriptor carries a chunk but no __hydrate.
		expect(String(isl.bindingSsrSource)).not.toContain('__hydrate');
		expect(String(isl.bindingSsrSource)).not.toContain('__module: ""');
		expect(String(isl.bindingClientSource)).not.toContain('make_region_endpoint');
		// host import now points at the leg-split binding module, attribute stripped
		expect(r!.code).toContain(`import Card from "${regionBindingVirtualId(iid)}"`);
		expect(r!.code).not.toContain('with {');
	});

	test('rejects region combined with another import attribute', () => {
		const bad = `<script>
			import Card from '$lib/Card.svelte' with { region: 'raw', wake: 'load' };
		</script>`;
		expect(() => transformHost(bad, '/app/src/routes/+page.svelte', makeCtx())).toThrow(
			/must be the only import attribute/
		);
	});

	test("rejects a region value other than 'raw'", () => {
		const bad = `<script>
			import Card from '$lib/Card.svelte' with { region: 'load' };
		</script>`;
		expect(() => transformHost(bad, '/app/src/routes/+page.svelte', makeCtx())).toThrow(
			/only takes the value 'raw'/
		);
	});
});

describe('an import attribute ogygia does not know, on a component import, fails the build', () => {
	const host = '/app/src/routes/+page.svelte';
	const page = (imports: string) => ['<script>', imports, '</script>'].join('\n');

	test('a misspelt key, alone on a .svelte import, is named with the keys there are', () => {
		const src = page(`import Card from '$lib/Card.svelte' with { wkae: 'load' };`);
		expect(() => transformHost(src, host, makeCtx())).toThrow(
			/`wkae`[\s\S]*`wake`[\s\S]*e\/region_attribute_unknown/
		);
	});

	test('the retired `partial:` key is one of them, beside a live region import or alone', () => {
		const beside = page(
			`import Card from '$lib/Card.svelte' with { partial: 'load' };\nimport Live from '$lib/Live.svelte' with { region: 'raw' };`
		);
		expect(() => transformHost(beside, host, makeCtx())).toThrow(/e\/region_attribute_unknown/);
		const alone = page(`import Card from '$lib/Card.svelte' with { partial: 'load' };`);
		expect(() => transformHost(alone, host, makeCtx())).toThrow(/e\/region_attribute_unknown/);
	});

	test('with renamed keys, a default name given up to another tool is left alone, and a typo lists the renamed keys', () => {
		const ctx = makeCtx({ importKeys: { wake: 'hydrate' } } as never);
		const given_up = page(`import Card from '$lib/Card.svelte' with { wake: 'load' };`);
		expect(() => transformHost(given_up, host, ctx)).not.toThrow();
		const typo = page(`import Card from '$lib/Card.svelte' with { hydrat: 'load' };`);
		expect(() => transformHost(typo, host, ctx)).toThrow(
			/`hydrat`[\s\S]*`hydrate`[\s\S]*e\/region_attribute_unknown/
		);
	});

	test('the standard `type` attribute on a component import is not ogygia’s', () => {
		const src = page(`import Card from '$lib/Card.svelte' with { type: 'css' };`);
		expect(transformHost(src, host, makeCtx())).toBe(null);
	});

	test('an attribute on an import that is not a component is left alone', () => {
		const src = page(
			`import data from './data.json' with { type: 'json' };\nimport Live from '$lib/Live.svelte' with { region: 'raw' };`
		);
		expect(() => transformHost(src, host, makeCtx())).not.toThrow();
	});

	test('in a .ts module too, and a json import there is left alone', () => {
		const id = '/app/src/lib/cards.ts';
		expect(() =>
			transformTsRegions(`import Card from './Card.svelte' with { wkae: 'load' };`, id, makeCtx())
		).toThrow(/`wkae`[\s\S]*e\/region_attribute_unknown/);
		expect(
			transformTsRegions(`import x from './x.json' with { type: 'json' };`, id, makeCtx())
		).toBe(null);
	});

	test.each([
		['used', `wake: 'load', partial: 'x'`, 'partial'],
		['used', `wake: 'visible', wkae: 'load'`, 'wkae'],
		['used', `partial: 'load', region: 'raw'`, 'partial'],
		['unused', `wake: 'load', partial: 'x'`, 'partial']
	])(
		'a bad key beside a good one on one %s import is named by its code: { %s }',
		(use, attrs, key) => {
			const markup = use === 'used' ? '\n<Card />' : '';
			const src = page(`import Card from '$lib/Card.svelte' with { ${attrs} };`) + markup;
			expect(() => transformHost(src, host, makeCtx())).toThrow(
				new RegExp(`\`${key}\`[\\s\\S]*e/region_attribute_unknown`)
			);
		}
	);

	test('a bad key beside a good one on one import is named by its code in a .ts module too', () => {
		const src = `import Card from './Card.svelte' with { wake: 'load', partial: 'x' };\nexport const c = [Card];`;
		expect(() => transformTsRegions(src, '/app/src/lib/cards.ts', makeCtx())).toThrow(
			/`partial`[\s\S]*e\/region_attribute_unknown/
		);
	});
});

describe('transformTsRegions — held region in .ts', () => {
	const id = '/app/src/lib/cards.remote.ts';

	test('region: raw registers a no-schedule descriptor and strips the attribute', () => {
		const src = `import Card from './Card.svelte' with { region: 'raw' };
import { query } from '$app/server';
export const loadCard = query(async (n) => region(Card, { id: n }));`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r).not.toBeNull();
		const iid = heldId('src/lib/Card.svelte');
		expect(r!.islands).toHaveLength(1);
		const isl = r!.islands[0];
		expect(isl.id).toBe(iid);
		expect(isl.server).toBe(true);
		expect(isl.kind).toBe('hydrate');
		expect(String(isl.bindingSsrSource)).not.toContain('__hydrate');
		expect(r!.code).toContain(`import Card from "${regionBindingVirtualId(iid)}"`);
		expect(r!.code).not.toContain('with {');
	});

	test('a real import AFTER a backtick inside a string is still rewritten (AST guard, not backtick count)', () => {
		// The old unescaped-backtick parity heuristic counted this in-string backtick and WRONGLY skipped
		// the real import below it. The AST guard knows the backtick sits inside a string literal.
		const src = `const x = "a \` b";
import Card from './Card.svelte' with { region: 'raw' };
export const f = region(Card, {});`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r).not.toBeNull();
		expect(r!.islands).toHaveLength(1);
		expect(r!.code).toContain(
			`import Card from "${regionBindingVirtualId(heldId('src/lib/Card.svelte'))}"`
		);
	});

	test('a held-region import that is only TEXT inside a template literal is left alone', () => {
		const src =
			"export const sample = `import Fake from './Fake.svelte' with { region: 'raw' };`;\n";
		const r = transformTsRegions(src, id, makeCtx());
		expect(r).toBeNull(); // nothing real to rewrite
	});

	test('a held-region import inside a JSDoc @example COMMENT is left alone (regression: ogygia src/index.ts)', () => {
		const src = `/**
 * @example
 *   import Chart from '$lib/Chart.svelte' with { wake: 'visible' };
 */
export const y = 1;`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r).toBeNull(); // the comment sample must NOT register a phantom island
	});

	// A `wake:` mark on a `.ts` registry bakes its schedule AND makes the binding MOUNTABLE — placeable
	// (Builder's `<svelte:component>`) yet still a HELD, crossable island (server:true + held) for
	// `region()` over the wire. A superset of the old descriptor-only shape.
	for (const [value, hydrate] of [
		['load', 'load'],
		['idle', 'idle'],
		['visible', 'visible'],
		['(max-width: 500px)', '(max-width: 500px)']
	] as const) {
		test(`wake: '${value}' → a mountable held binding (__hydrate ${hydrate})`, () => {
			const s = `import C from './C.svelte' with { wake: '${value}' };
export const f = region(C, {});`;
			const r = transformTsRegions(s, id, makeCtx());
			const isl = r!.islands[0];
			expect(isl.kind).toBe('hydrate');
			expect(isl.strategy).toBe(hydrate);
			// HELD + crossable: keeps its server-manifest entry + the live/morph mark (so `region()` can
			// stream it over the wire), exactly like the old descriptor.
			expect(isl.server).toBe(true);
			expect(isl.held).toBe(true);
			// MOUNTABLE (the new bit): the binding is the wrapper component with the descriptor
			// Object.assign'd on, plus a wrapper `.svelte` that renders the `<ogygia-region>` shell.
			expect(String(isl.bindingSsrSource)).toContain('Object.assign(__OgygiaWrap');
			expect(String(isl.bindingSsrSource)).toContain('export default __OgygiaWrap');
			expect(String(isl.wrapperSource)).toContain('OgygiaRegion__Wrapper __mode="island"');
			// HOLDABLE: region() still reads the baked schedule + component + signer off the binding.
			expect(String(isl.bindingSsrSource)).toContain(`__hydrate: ${JSON.stringify(hydrate)}`);
			expect(String(isl.bindingSsrSource)).toContain('__component');
			expect(String(isl.bindingSsrSource)).toContain('make_region_endpoint');
			// Distinct schedules mint distinct ids; a `wake:` id differs from a raw descriptor.
			expect(isl.id).toBe(heldId('src/lib/C.svelte', hydrate));
			expect(isl.id).not.toBe(heldId('src/lib/C.svelte'));
		});
	}

	test('wake: visible bakes a hydrate margin (from ctx.visibleMargin)', () => {
		const s = `import C from './C.svelte' with { wake: 'visible' };
export const f = region(C, {});`;
		const r = transformTsRegions(s, id, makeCtx({ visibleMargin: '200px' }));
		expect(String(r!.islands[0].bindingSsrSource)).toContain('__hydrateMargin: "200px"');
	});

	test('rejects an unknown wake value', () => {
		const bad = `import C from './C.svelte' with { wake: 'sometimes' };`;
		expect(() => transformTsRegions(bad, id, makeCtx())).toThrow(/unknown .*wake.* strategy/);
	});

	test('a .svelte region:raw and a .ts region:raw of the same component share one id', () => {
		const svelteId = heldId('src/lib/Card.svelte');
		const src = `import Card from '$lib/Card.svelte' with { region: 'raw' };
export const loadCard = region(Card, {});`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r!.islands[0].id).toBe(svelteId);
	});

	test('returns null when no held import is present', () => {
		expect(transformTsRegions(`export const x = 1;`, id, makeCtx())).toBeNull();
	});

	test('render: deferred → a .ts server island; import rewritten to the WRAPPER', () => {
		const src = `import D from './D.svelte' with { render: 'deferred' };
export const page = D;`;
		const r = transformTsRegions(src, id, makeCtx());
		const isl = r!.islands[0];
		expect(isl.server).toBe(true);
		expect(isl.kind).toBe('defer');
		expect(isl.strategy).toBe('server');
		expect(isl.fetchWhen).toBe('load');
		// the wrapper renders the server shell AND keeps the ogygiaFallback slot the router supplies
		expect(String(isl.wrapperSource)).toContain('OgygiaRegion__Wrapper __mode="server"');
		expect(String(isl.wrapperSource)).toContain('ogygiaFallback');
		// placed as `<D/>` the wrapper must emit the hole — so the import points at the wrapper, not a binding
		expect(r!.code).toContain('ogygia:region/wrapper/');
	});

	test('render: deferred takes `fetch` as its timing (+ margin on visible)', () => {
		const src = `import D from './D.svelte' with { render: 'deferred', fetch: 'visible' };
export const page = D;`;
		const r = transformTsRegions(src, id, makeCtx({ visibleMargin: '150px' }));
		const isl = r!.islands[0];
		expect(isl.fetchWhen).toBe('visible');
		expect(String(isl.wrapperSource)).toContain('__margin');
	});

	test('render: deferred accepts fetch: interaction (an on-demand hole) and rejects none', () => {
		const ok = `import D from './D.svelte' with { render: 'deferred', fetch: 'interaction' };`;
		const r = transformTsRegions(ok, id, makeCtx());
		expect(r!.islands[0].fetchWhen).toBe('interaction');
		const bad = `import D from './D.svelte' with { render: 'deferred', fetch: 'none' };`;
		expect(() => transformTsRegions(bad, id, makeCtx())).toThrow(/a hole must fetch/);
	});

	test('wake on a render: deferred import fails the build, naming the fetch to write', () => {
		const old = `import D from './D.svelte' with { render: 'deferred', wake: 'visible' };`;
		expect(() => transformTsRegions(old, id, makeCtx())).toThrow(
			/ships no JS, so `wake` never applies[\s\S]*fetch: 'visible'[\s\S]*e\/hole_wake_removed/
		);
	});

	test('a hole with both fetch and wake fails on its wake', () => {
		const both = `import D from './D.svelte' with { render: 'deferred', fetch: 'idle', wake: 'visible' };`;
		expect(() => transformTsRegions(both, id, makeCtx())).toThrow(/e\/hole_wake_removed/);
	});

	test('a lone fetch is refused (it is a deferred hole’s timing)', () => {
		const lone = `import D from './D.svelte' with { fetch: 'visible' };`;
		expect(() => transformTsRegions(lone, id, makeCtx())).toThrow(/without `render: 'deferred'`/);
	});

	test('render: live is rejected on a .ts import (svelte-only)', () => {
		const bad = `import D from './D.svelte' with { render: 'live' };`;
		expect(() => transformTsRegions(bad, id, makeCtx())).toThrow(/live|\.svelte/i);
	});
});

describe('transformTsRegions — a marked named import (barrel / named in .ts)', () => {
	const id = '/app/src/lib/registry.ts';
	const isl0 = (r: ReturnType<typeof transformTsRegions>) => r!.islands[0];

	test('a NAMED barrel import → a mountable held binding (same record as a .ts wake mark)', () => {
		const src = `import { Header as HeaderRegion } from '@design/system' with { wake: 'visible' };
export const registry = [{ name: 'header', component: HeaderRegion }];`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r).not.toBeNull();
		expect(r!.islands).toHaveLength(1);
		const isl = isl0(r);
		// mountable + held (server:true) + the named export threaded through the entry + wrapper
		expect(isl.server).toBe(true);
		expect(isl.held).toBe(true);
		expect(String(isl.bindingSsrSource)).toContain('Object.assign(__OgygiaWrap');
		expect(String(isl.bindingSsrSource)).toContain('__hydrate: "visible"');
		expect(String(isl.source)).toMatch(
			/import \{ Header as __OgygiaComp_[0-9a-f]+ \} from ["']@design\/system["']/
		);
		// the import is rewritten to the binding import, under its local name
		expect(r!.code).toMatch(
			new RegExp(
				`import HeaderRegion from ["']${regionBindingVirtualId(isl.id as string).replace(/\./g, '\\.')}["']`
			)
		);
		expect(r!.code).not.toContain('@design/system');
		// identity keys on source#exportName
		expect(isl.id).toBe(
			regionId(
				regionIdentity('@design/system#Header', {
					strategy: 'held',
					options: { hydrate: 'visible', hydrateMargin: '0px' }
				})
			)
		);
	});

	test('region: raw on a named import → a bare held descriptor with the named import', () => {
		const src = `import { Block as BlockRegion } from '@design/system' with { region: 'raw' };
export const f = () => region(BlockRegion, {});`;
		const r = transformTsRegions(src, id, makeCtx());
		const isl = isl0(r);
		expect(isl.server).toBe(true);
		expect(String(isl.bindingSsrSource)).toContain('export default {');
		expect(String(isl.bindingSsrSource)).not.toContain('Object.assign');
		expect(String(isl.source)).toMatch(
			/import \{ Block as __OgygiaComp_[0-9a-f]+ \} from ["']@design\/system["']/
		);
	});

	test('a `{ default as X }` import is the default export', () => {
		const src = `import { default as CardRegion } from './Card.svelte' with { wake: 'load' };
export const registry = [CardRegion];`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r!.islands).toHaveLength(1);
		expect(String(isl0(r).source)).toMatch(
			/import __OgygiaComp_[0-9a-f]+ from ["'][^"']*Card\.svelte["']/
		);
	});

	test('two named exports of one barrel → two distinct islands', () => {
		const src = `import { Header as H, Footer as F } from '@design/system' with { wake: 'load' };
export const registry = [H, F];`;
		const r = transformTsRegions(src, id, makeCtx());
		expect(r!.islands).toHaveLength(2);
		expect(new Set(r!.islands.map((i) => i.id)).size).toBe(2);
	});
});

describe('transformTsRegions — the module rules', () => {
	const id = '/app/src/lib/blocks.ts';
	const ts = (src: string, ctx = makeCtx()) => transformTsRegions(src, id, ctx);
	const code_of = (fn: () => unknown) => {
		try {
			fn();
		} catch (e) {
			return (e as { code?: string }).code;
		}
		return 'compiled';
	};

	test("render: 'live' is refused in a .ts module with its own code", () => {
		expect(
			code_of(() => ts(`import L from './L.svelte' with { render: 'live' };\nexport const b = L;`))
		).toBe('held_render_live');
	});

	test('region beside another key, or render beside a key it does not take, is a mixed marker set', () => {
		for (const attrs of [`region: 'raw', fetch: 'load'`, `render: 'deferred', keep: 'x'`])
			expect(
				code_of(() => ts(`import C from './C.svelte' with { ${attrs} };\nexport const b = C;`))
			).toBe('held_marker_mixed');
	});

	test("a .ts hole's client wrapper never imports its component or entry", () => {
		const r = ts(`import D from './D.svelte' with { render: 'deferred' };\nexport const b = D;`)!;
		const hole = r.islands[0] as { wrapperClientSource: string };
		expect(hole.wrapperClientSource).not.toContain('__OgygiaEntry');
		expect(hole.wrapperClientSource).not.toContain('D.svelte');
	});

	test('a module that does not parse is left to the bundler (null)', () => {
		expect(
			ts(`import C from './C.svelte' with { wake: 'load' };\nexport const b = C +;`)
		).toBeNull();
	});

	test('a declared package keys its .ts regions by package, not by install path', () => {
		const src = `import C from './C.svelte' with { wake: 'load' };\nexport const b = C;`;
		const at = (dir: string) =>
			transformTsRegions(
				src,
				`${dir}/src/blocks.ts`,
				makeCtx({
					pkg_identity: (p: string) => (p.startsWith(dir) ? `pkg${p.slice(dir.length)}` : null)
				})
			)!.islands[0].id;
		expect(at('/store/pkg@1/pkg')).toBe(at('/store/pkg@2/pkg'));
	});

	test("a .ts wake: 'none' is refused: a lake lives in a host", () => {
		expect(
			code_of(() => ts(`import C from './C.svelte' with { wake: 'none' };\nexport const b = C;`))
		).toBe('wake_strategy_unknown');
	});
});
