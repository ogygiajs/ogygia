import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __set_build_cache_root } from '@ogygia/compiler';
import { dedent } from '@ogygia/core/plugin/utils';

const pkg_root = fileURLToPath(new URL('..', import.meta.url));
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'og-md-cache-reader-'));
const copies = fs.mkdtempSync(path.join(pkg_root, '.reader-copies-'));
__set_build_cache_root(cache);
afterAll(() => {
	__set_build_cache_root(undefined);
	fs.rmSync(cache, { recursive: true, force: true });
	fs.rmSync(copies, { recursive: true, force: true });
});

type Preprocess = typeof import('../src/markdown/index.ts').ogygiaPreprocess;

/** A copy of this package at the same version, its frontmatter reader changed by `edit`. */
const copy = (name: string, edit: (reader: string) => string): string => {
	const dir = path.join(copies, name);
	fs.cpSync(path.join(pkg_root, 'src'), path.join(dir, 'src'), { recursive: true });
	fs.copyFileSync(path.join(pkg_root, 'package.json'), path.join(dir, 'package.json'));
	const reader = path.join(dir, 'src/markdown/frontmatter.ts');
	const before = fs.readFileSync(reader, 'utf8');
	const after = edit(before);
	fs.writeFileSync(reader, after);
	return dir;
};

const compile = async (dir: string, content: string): Promise<string> => {
	const mod = (await import(path.join(dir, 'src/markdown/index.ts'))) as {
		ogygiaPreprocess: Preprocess;
	};
	const out = await mod.ogygiaPreprocess().markup!({
		content,
		filename: '/app/src/content/docs/intro.md'
	});
	return (out as { code: string }).code;
};

describe('markup cache across a reader change', () => {
	it('a reader changed between releases is not served the old reader’s parse', async () => {
		const old_reader = copy('old', (s) => s);
		const new_reader = copy('new', (s) => {
			const edited = s.replace(
				'const result = parse_block(ctx, base);',
				"const result = { ...(parse_block(ctx, base) as object), reader: 'new' };"
			);
			expect(edited).not.toBe(s);
			return edited;
		});
		const doc = `${dedent`
			---
			title: Intro
			---

			# Intro
		`}\n`;

		expect(await compile(old_reader, doc)).not.toContain('"reader":"new"');
		expect(await compile(new_reader, doc)).toContain('"reader":"new"');
	});
});
