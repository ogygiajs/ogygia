import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';

const pkg_root = fileURLToPath(new URL('..', import.meta.url));
const copies = fs.mkdtempSync(path.join(pkg_root, '.bridge-copies-'));
afterAll(() => fs.rmSync(copies, { recursive: true, force: true }));

/** A copy of this package at the same version, its markdown bridge's source changed by `edit`. */
function copy(name: string, edit: (source: string) => string): string {
	const dir = path.join(copies, name);
	fs.cpSync(path.join(pkg_root, 'src'), path.join(dir, 'src'), { recursive: true });
	fs.copyFileSync(path.join(pkg_root, 'package.json'), path.join(dir, 'package.json'));
	const file = path.join(dir, 'src/vite/markdown.ts');
	fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')));
	return dir;
}

async function key_of(dir: string): Promise<string> {
	const mod = (await import(
		path.join(dir, 'src/vite/markdown.ts')
	)) as typeof import('../src/vite/markdown.ts');
	return mod.markdown_extension({})!.cache_key();
}

describe('the markdown extension cache key', () => {
	test('a change to the image plugin’s code is a new key, so content never serves a doc it compiled before', async () => {
		const before = copy('before', (s) => s);
		const after = copy('after', (s) => s.replace('const COMPONENT = ', 'const COMPONENT =  '));
		expect(await key_of(after)).not.toBe(await key_of(before));
	});
});
