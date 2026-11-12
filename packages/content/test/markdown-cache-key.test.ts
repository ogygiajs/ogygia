/**
 * The doc-level markup cache lives on disk (`node_modules/.ogygia`), so it outlives a file move.
 * Its key must cover every input the cached code embeds: a moved file with the same content gets
 * its own CSS key, never the old path's (#292).
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __set_build_cache_root } from '@ogygia/compiler';
import { ogygiaPreprocess } from '../src/markdown/index.ts';
import { dedent } from '@ogygia/core/plugin/utils';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-md-cache-key-'));
__set_build_cache_root(tmp);
afterAll(() => {
	__set_build_cache_root(undefined);
	fs.rmSync(tmp, { recursive: true, force: true });
});

const css_key = (code: string): unknown =>
	JSON.parse(/export const __ogygia_css = (".*?");/.exec(code)?.[1] ?? 'null');

const compile = async (filename: string, content: string): Promise<string> => {
	// a new preprocessor each time: a later build, reading what the earlier one left on disk
	const out = await ogygiaPreprocess().markup!({ content, filename });
	return (out as { code: string }).code;
};

describe('markup cache key', () => {
	const content = `${dedent`
		# Intro

		The same words in both places.
	`}\n`;

	it('a moved file with the same content bakes its own CSS key', async () => {
		const v1 = await compile('/app/src/content/v1/intro.md', content);
		expect(css_key(v1)).toBe('content/v1/intro.md');
		const v2 = await compile('/app/src/content/v2/intro.md', content);
		expect(css_key(v2)).toBe('content/v2/intro.md');
	});

	it('the same file compiled again still hits the cache', async () => {
		const first = await compile('/app/src/content/v3/intro.md', content);
		const entries = fs.readdirSync(path.join(tmp, 'markup')).length;
		const again = await compile('/app/src/content/v3/intro.md', content);
		expect(again).toBe(first);
		expect(fs.readdirSync(path.join(tmp, 'markup')).length).toBe(entries);
	});
});
