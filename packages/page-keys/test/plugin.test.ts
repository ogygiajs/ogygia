// The plugin's answers, as core asks for them (`PageReads`): a module is read once, a helper call
// is unknown until `settle` follows it, an unpinned read is `'unknown'` with its reason, and the
// dev answer for a set of files matches what the build would say.
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import type { BuildContext, PageReads, PluginDefinition } from '@ogygia/compiler/vite';
import { pageKeys, page_reads } from '../src/index.ts';

const files: Record<string, string> = {
	'/app/src/lib/A.svelte': dedent`
		<script>
			import { page } from '$app/state';
			import { lang } from '$lib/lang';
		</script>
		<p>{page.data.user} {lang(page)}</p>
	`,
	'/app/src/lib/lang.ts': dedent`
		export function lang(p) { return p.data._locale; }
	`,
	'/app/src/lib/B.ts': dedent`
		import { page } from '$app/state';
		export const all = { ...page.data };
	`,
	'/app/src/lib/C.ts': `export const c = 1;`,
	'/app/src/lib/D.css': `import '$app/state';`
};
const read = (f: string) => files[f] ?? null;
const resolve = async (spec: string) =>
	spec === '$lib/lang' ? { id: '/app/src/lib/lang.ts' } : null;

describe('page_reads', () => {
	it('a helper call is unknown until settled, then folds in its keys', async () => {
		const r = page_reads(read);
		r.module('/app/src/lib/A.svelte', files['/app/src/lib/A.svelte']);
		expect(r.keys('/app/src/lib/A.svelte')).toBe('unknown');
		await r.settle(resolve);
		expect([...(r.keys('/app/src/lib/A.svelte') as Set<string>)].sort()).toEqual([
			'_locale',
			'user'
		]);
		expect(r.why('/app/src/lib/A.svelte')).toBeNull();
	});

	it("an unpinned read is 'unknown' with its line; a module that never reads the page is null", () => {
		const r = page_reads(read);
		for (const f of ['/app/src/lib/B.ts', '/app/src/lib/C.ts', '/app/src/lib/D.css'])
			r.module(f, files[f]);
		expect(r.keys('/app/src/lib/B.ts')).toBe('unknown');
		expect(r.why('/app/src/lib/B.ts')).toMatchObject({ line: 2 });
		expect(r.keys('/app/src/lib/C.ts')).toBeNull();
		// (not a script or a component: never read)
		expect(r.keys('/app/src/lib/D.css')).toBeNull();
		expect(r.keys('/app/src/lib/never-seen.ts')).toBeNull();
	});

	it("dev: the files' keys together, a helper followed; an unresolved helper is unknown with why", async () => {
		const r = page_reads(read);
		expect(await r.dev(['/app/src/lib/A.svelte', '/app/src/lib/C.ts'], resolve)).toEqual({
			keys: expect.arrayContaining(['_locale', 'user']),
			why: []
		});
		const lost = await r.dev(['/app/src/lib/A.svelte'], async () => null);
		expect(lost.keys).toBe('unknown');
		expect(lost.why[0].why).toContain('lang()');
		expect(await r.dev(['/app/src/lib/C.ts'], resolve)).toEqual({ keys: null, why: [] });
	});
});

describe('pageKeys()', () => {
	it('registers one seed-shaping answer with the build', () => {
		const plugin = pageKeys();
		expect(plugin.name).toBe('@ogygia/page-keys');
		const definition = (plugin as unknown as Record<symbol, PluginDefinition>)[
			Symbol.for('ogygia.plugin')
		];
		const got: PageReads[] = [];
		definition.build!({
			pageReads: (r: PageReads) => got.push(r)
		} as Partial<BuildContext> as BuildContext);
		expect(got).toHaveLength(1);
		expect(typeof got[0].keys).toBe('function');
	});
});
