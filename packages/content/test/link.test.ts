// The dialect's `a`: a bare href is a page address, resolved through the site under the shell's
// mount; an old address resolves to its page; anything else is left as written.
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Link from '../src/site/components/Link.svelte';

const SHELL = Symbol.for('ogygia.content.shell');

const asked: string[] = [];
const outline = {
	async resolve(slug: string) {
		asked.push(slug);
		return slug === 'regions/held' ? { record: { slug: 'regions/held' } } : undefined;
	},
	async alias(slug: string) {
		return slug === 'regions/old' ? 'regions/held' : undefined;
	}
};

async function href(to: string, shell = true) {
	const context = new Map<unknown, unknown>(
		shell ? [[SHELL, { site: { outline }, base: '/docs/' }]] : []
	);
	const children = createRawSnippet(() => ({ render: () => '<span>x</span>' }));
	const { body } = await render(Link, { props: { href: to, children }, context });
	return body.match(/<a href="([^"]*)"/)?.[1];
}

describe('Link', () => {
	it('resolves a bare href through the site under the shell base, keeping its fragment', async () => {
		expect(await href('regions/held')).toBe('/docs/regions/held');
		expect(await href('regions/held#wake')).toBe('/docs/regions/held#wake');
	});

	it('resolves an old address to its page', async () => {
		expect(await href('regions/old#wake')).toBe('/docs/regions/held#wake');
	});

	it('leaves an unknown address as written', async () => {
		expect(await href('regions/nope')).toBe('regions/nope');
	});

	it('passes absolute, external, anchor and relative hrefs through without asking the site', async () => {
		asked.length = 0;
		for (const h of [
			'https://example.com/a',
			'mailto:a@example.com',
			'/abs',
			'#top',
			'./img.png',
			'//cdn.example.com/x'
		])
			expect(await href(h)).toBe(h);
		expect(asked).toEqual([]);
	});

	it('passes a bare href through outside a shell', async () => {
		expect(await href('regions/held', false)).toBe('regions/held');
	});
});
