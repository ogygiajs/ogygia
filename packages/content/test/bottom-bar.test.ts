// BottomBar: a labelled nav that holds `lead` at its start and `actions` at its end.
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BottomBar from '../src/site/components/BottomBar.svelte';

const html = (s: string) => createRawSnippet(() => ({ render: () => s }));

async function bar(props: Record<string, unknown> = {}) {
	const { body } = await render(BottomBar, { props });
	return body.replace(/<!--[^>]*-->/g, ''); // the hydration markers
}

describe('BottomBar', () => {
	it('is a nav labelled Site unless given a label', async () => {
		expect(await bar()).toContain('<nav class="og-bottombar" aria-label="Site">');
		expect(await bar({ label: 'Docs' })).toContain('<nav class="og-bottombar" aria-label="Docs">');
	});

	it('holds lead in its lead slot and actions in its actions slot', async () => {
		const body = await bar({ lead: html('<b>brand</b>'), actions: html('<i>menu</i>') });
		expect(body).toMatch(/<div class="og-bottombar-lead">\s*<b>brand<\/b>\s*<\/div>/);
		expect(body).toMatch(/<div class="og-bottombar-actions">\s*<i>menu<\/i>\s*<\/div>/);
	});
});
