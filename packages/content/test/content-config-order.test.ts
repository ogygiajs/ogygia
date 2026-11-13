/**
 * THE SVELTE CONFIG READS WHAT `content()` SET, SO `content()` RUNS FIRST. The svelte config's
 * `extensions()` and `preprocess()` read the markdown settings `content({ markdown })` puts on the
 * bridge. A vite config that loads the svelte config before it calls `content()` (an import at its
 * top) gets `.svelte` alone and no markdown preprocessor: no markdown file compiles, and nothing said
 * why. Now `content()` refuses, by code, when markdown is on and the svelte config already read none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content, extensions, preprocess } from '../src/vite/index.ts';
import { bridge } from '../src/bridge.ts';

const saved: Partial<typeof bridge> = {};
beforeEach(() => {
	saved.markdownConfig = bridge.markdownConfig;
	saved.contentPresets = bridge.contentPresets;
	saved.markdownOrder = bridge.markdownOrder;
	// a process where nothing ran yet
	bridge.markdownConfig = null;
	bridge.markdownOrder = 'unset';
});
afterEach(() => {
	bridge.markdownConfig = saved.markdownConfig ?? null;
	bridge.contentPresets = saved.contentPresets ?? null;
	bridge.markdownOrder = saved.markdownOrder ?? 'unset';
});

describe('content() and the svelte config', () => {
	it('markdown on, after the svelte config read its extensions: content() says so by code', () => {
		expect(extensions()).toEqual(['.svelte']);
		expect(() => content({ markdown: {} })).toThrow(/content_config_read_first/);
	});

	it('the same for the preprocessor', () => {
		expect(preprocess()).toEqual([]);
		expect(() => content({ markdown: {} })).toThrow(/content_config_read_first/);
	});

	it('content() first, then the svelte config: markdown is on', () => {
		content({ markdown: {} });
		expect(extensions()).toEqual(['.svelte', '.svx', '.md']);
		expect(preprocess()).toHaveLength(1);
	});

	it('no markdown: an early read is right, and content() lets it be', () => {
		expect(extensions()).toEqual(['.svelte']);
		expect(() => content({})).not.toThrow();
	});
});
