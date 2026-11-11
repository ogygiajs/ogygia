// One Shiki highlighter per set of themes and languages, made once and kept. Two theme objects
// with no name are two themes (their colors, not their missing names, tell them apart), for the
// highlighter and for the fence cache's key. Rendering snippets, or highlighting with a config
// other than the last one, does not make a new highlighter each time.
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { highlight, normalize_shiki, fence_config_key } from '../src/markdown/shiki.ts';
import { render_snippet } from '../src/markdown/snippet.ts';
import { default_pipeline } from '../src/markdown/code-render.ts';
import { __set_fence_cache_dir } from '../src/markdown/fence-cache.ts';
import { warm_shiki } from './_shiki-warm.ts';

// (the engine and grammars, warmed: each test times only the highlighters it makes)
warm_shiki();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-shiki-'));
beforeAll(() => __set_fence_cache_dir(tmp));
afterAll(() => {
	__set_fence_cache_dir(undefined);
	fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

/** A theme object with no `name`, its keywords in `color`. (Typed with the optional `name` the
 *  theme input reads, so TypeScript takes it for one.) */
type UnnamedTheme = {
	name?: string;
	type: 'light' | 'dark';
	colors: Record<string, string>;
	tokenColors: Array<{ scope: string[]; settings: { foreground: string } }>;
};
const theme = (color: string, type: 'light' | 'dark'): UnnamedTheme => ({
	type,
	colors: { 'editor.background': type === 'light' ? '#ffffff' : '#000000' },
	tokenColors: [{ scope: ['keyword', 'storage.type'], settings: { foreground: color } }]
});

it('two unnamed theme objects are two themes', async () => {
	const red = { themes: { light: theme('#ff0000', 'light'), dark: theme('#aa0000', 'dark') } };
	const blue = { themes: { light: theme('#0000ff', 'light'), dark: theme('#0000aa', 'dark') } };
	const a = await highlight('const x = 1;', 'js', red);
	const b = await highlight('const x = 1;', 'js', blue);
	expect(a.toLowerCase()).toContain('#ff0000');
	expect(b.toLowerCase()).toContain('#0000ff');
	expect(b.toLowerCase()).not.toContain('#ff0000');
	// and the fence cache tells their fences apart
	const pipe = default_pipeline();
	expect(fence_config_key(normalize_shiki(red), pipe)).not.toEqual(
		fence_config_key(normalize_shiki(blue), pipe)
	);
}, 30_000);

it('snippets, and highlights that alternate configs, do not make a highlighter each time', async () => {
	const warns: unknown[][] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a));
	const run = Math.random().toString(36).slice(2); // (no fence cache hit from an earlier run)
	for (let i = 0; i < 12; i++) await render_snippet(null, `let v${i}_${run} = ${i};`, 'js');
	const light = { themes: { light: 'github-light', dark: 'github-dark' } };
	const dark = { themes: { light: 'min-light', dark: 'min-dark' } };
	for (let i = 0; i < 6; i++) {
		await highlight(`let a${i} = 1;`, 'js', light);
		await highlight(`let b${i} = 1;`, 'js', dark);
	}
	// Shiki says so once ten highlighters are alive at once
	expect(warns.filter((a) => String(a[0]).includes('instances have been created'))).toEqual([]);
}, 60_000);
