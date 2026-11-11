import { describe, it, expect } from 'vitest';
import { highlight } from '../src/markdown/shiki.ts';
import { inline_markers } from '../src/markdown/inline-markers.ts';
import { warm_shiki } from './_shiki-warm.ts';

// ─────────────────────────────────────────────────────────────────────────────
// The `+++added+++` / `---removed---` INLINE dialect (svelte.dev's span-level marks),
// upstreamed from the svelte-dev stress-test app.
// ─────────────────────────────────────────────────────────────────────────────

const OPTS = { transformers: [inline_markers()] };
warm_shiki(OPTS, 'js');

describe('inline_markers', () => {
	// (the file's first highlight makes Shiki's highlighter: seconds on a loaded CI runner)
	it('wraps an added span, strips the delimiters', async () => {
		const html = await highlight('let +++count+++ = 0;', 'js', OPTS);
		expect(html).toContain('og-mark-add');
		expect(html).not.toContain('+++');
		expect(html).toContain('count');
	}, 30_000);

	it('wraps a removed span and keeps its content visible', async () => {
		const html = await highlight('let ---old--- fresh = 1;', 'js', OPTS);
		expect(html).toContain('og-mark-remove');
		expect(html).not.toContain('---');
		expect(html).toContain('old');
	});

	it('a --- alone on its line is never a marker (frontmatter / hr shown in a fence)', async () => {
		const html = await highlight('---\ntitle: hi\n---', 'js', OPTS);
		expect(html).not.toContain('og-mark');
		expect(html.match(/---/g)!.length).toBeGreaterThanOrEqual(2);
	});

	it('an unpaired marker is left as-is', async () => {
		const html = await highlight('let a = +++b;', 'js', OPTS);
		expect(html).toContain('+++');
		expect(html).not.toContain('og-mark');
	});

	it('skips markdown-family fences — a docs page showing the syntax renders it literally', async () => {
		const html = await highlight('let +++count+++ = 0;', 'md', OPTS);
		expect(html).not.toContain('og-mark');
		expect(html).toContain('+++');
	});

	it('custom classes replace the defaults (the svelte.dev skin)', async () => {
		const html = await highlight('let +++x+++;', 'js', {
			transformers: [
				inline_markers({ classes: { add: 'highlight add', remove: 'highlight remove' } })
			]
		});
		expect(html).toContain('class="highlight add"');
		expect(html).not.toContain('og-mark');
	});

	it('a multi-line highlight closes and reopens per line (spans cannot cross lines)', async () => {
		const html = await highlight('+++let a = 1;\nlet b = 2;+++', 'js', OPTS);
		const opens = html.match(/class="og-mark og-mark-add"/g) ?? [];
		expect(opens.length).toBeGreaterThanOrEqual(2);
	});

	it('removed content is text: markup in it is escaped, never live HTML (#396)', async () => {
		const html = await highlight('---<a href="..." data-x="off">---', 'svelte', OPTS);
		expect(html).toContain('og-mark-remove');
		expect(html).not.toContain('<a href');
		expect(html).toContain('&lt;a href');
	});

	it('removed content keeps a $ pattern as written (#396)', async () => {
		const html = await highlight('let x = ---"$\'" + "$&"--- 1;', 'js', OPTS);
		expect(html).toContain("$'");
		expect(html).toContain('$&amp;');
	});
});
