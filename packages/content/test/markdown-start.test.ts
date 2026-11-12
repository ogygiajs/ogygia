// The markdown pipeline's lazy starts (#248): Shiki's highlighter and the mdsvex instance are made
// on first use and kept. A start that fails (a grammar or a plugin that failed to load) is not kept:
// the next render starts again. The real Shiki and mdsvex, each failing its first start.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { highlight } from '../src/markdown/shiki.ts';
import { ogygiaPreprocess } from '../src/markdown/index.ts';
import { dedent } from '@ogygia/core/plugin/utils';

const fail = vi.hoisted(() => ({ highlighter: 0, mdsvex: 0, highlighters: 0 }));

vi.mock('shiki', async (importOriginal) => {
	const real = await importOriginal<typeof import('shiki')>();
	return {
		...real,
		createHighlighter: async (...args: Parameters<typeof real.createHighlighter>) => {
			fail.highlighters++;
			if (fail.highlighter > 0) {
				fail.highlighter--;
				throw new Error('a grammar failed to load');
			}
			return real.createHighlighter(...args);
		}
	};
});

vi.mock('mdsvex', async (importOriginal) => {
	const real = await importOriginal<typeof import('mdsvex')>();
	return {
		...real,
		mdsvex: (...args: Parameters<typeof real.mdsvex>) => {
			if (fail.mdsvex > 0) {
				fail.mdsvex--;
				throw new Error('a plugin failed to load');
			}
			return real.mdsvex(...args);
		}
	};
});

beforeEach(() => {
	Object.assign(fail, { highlighter: 0, mdsvex: 0, highlighters: 0 });
});

describe('the highlighter never keeps a failed start (#248)', () => {
	// (its own languages: a highlighter no other test in this file has started)
	const opts = { langs: ['js', 'css'] };

	it('the first start fails: the next highlight starts it again', async () => {
		fail.highlighter = 1;
		await expect(highlight('let a = 1;', 'js', opts)).rejects.toThrow('a grammar failed to load');
		const html = await highlight('let a = 1;', 'js', opts);
		expect(html).toContain('<pre');
		expect(fail.highlighters).toBe(2);
	});

	it('once started it is kept: highlights while it starts share the one start', async () => {
		const langs = { langs: ['js', 'json'] };
		await Promise.all([highlight('1', 'js', langs), highlight('2', 'json', langs)]);
		await highlight('3', 'js', langs);
		expect(fail.highlighters).toBe(1);
	});
});

describe('the markdown preprocessor never keeps a failed start (#248)', () => {
	it('mdsvex fails to start: the next page renders', async () => {
		fail.mdsvex = 1;
		const pp = ogygiaPreprocess();
		// (a page no run has rendered before: a rendered page is kept in the build cache on disk)
		const nonce = `${Date.now()}-${Math.random()}`;
		const page = {
			content: dedent`
			# Hello

			The first page, ${nonce}.
		`,
			filename: '/x/first.md'
		};
		await expect(pp.markup!(page)).rejects.toThrow('a plugin failed to load');
		const out = (await pp.markup!(page)) as { code: string };
		expect(out.code).toContain(`<p>The first page, ${nonce}.</p>`);
	});
});
