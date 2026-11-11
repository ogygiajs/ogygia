import { readFileSync } from 'node:fs';
import { createRawSnippet } from 'svelte';
import { compile, parse } from 'svelte/compiler';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import DocsShell from '../src/site/components/DocsShell.svelte';
import type { SiteMeta } from '../src/site/site.ts';

const SOURCE = new URL('../src/site/components/DocsShell.svelte', import.meta.url);

const meta: SiteMeta = {
	nav: [{ kind: 'leaf', slug: 'a', href: '/docs/a', title: 'A' }],
	switcher: null
};
const children = createRawSnippet(() => ({ render: () => '<p>body</p>' }));

/** The shell's server HTML for these props. */
async function html(props: Record<string, unknown>): Promise<string> {
	return (await render(DocsShell, { props: { meta, base: '/docs', children, ...props } })).body;
}

describe('DocsShell regions', () => {
	it('renders the built-in header when the prop is absent', async () => {
		const out = await html({});
		expect(out).toContain('og-cheader');
		expect(out).not.toContain('og-headerless');
	});

	it('drops the header when the prop is passed as undefined, as it does for null', async () => {
		for (const header of [undefined, null]) {
			const out = await html({ header });
			expect(out).not.toContain('<header');
			expect(out).toContain('og-headerless');
		}
	});
});

describe('DocsShell styling is opt-in', () => {
	it('imports no stylesheet and carries no styles of its own', () => {
		const source = readFileSync(SOURCE, 'utf8');
		const imports = parse(source, { modern: true })
			.instance!.content.body.filter((s) => s.type === 'ImportDeclaration')
			.map((s) => String(s.source.value));
		expect(imports.filter((i) => i.endsWith('.css'))).toEqual([]);
		expect(imports).not.toHaveLength(0);
		const compiled = compile(source, {
			filename: 'DocsShell.svelte',
			experimental: { async: true }
		});
		expect(compiled.css).toBeNull();
	});
});
