// `ogygia.files` discovery over an install that is not whole: a dependency missing from
// node_modules, a manifest that does not parse, a glob that meets a dangling symlink. Each declares
// nothing (or lists nothing for that entry), and discovery goes on.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs, {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discover_package_files } from '../src/vite/package-files.ts';

let app: string;
const write = (rel: string, content = '') => {
	const abs = path.join(app, rel);
	mkdirSync(path.dirname(abs), { recursive: true });
	writeFileSync(abs, content);
};

beforeAll(() => {
	app = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-pkg-edges-')));
	write(
		'package.json',
		JSON.stringify({ name: 'app', dependencies: { missing: '1', broken: '1', widgets: '1' } })
	);
	write('node_modules/broken/package.json', '{"name": "broken", ');
	write(
		'node_modules/widgets/package.json',
		JSON.stringify({ name: 'widgets', ogygia: { files: ['./lib/*.svelte'] } })
	);
	write('node_modules/widgets/lib/A.svelte');
	symlinkSync(
		path.join(app, 'node_modules/widgets/lib/gone.svelte'),
		path.join(app, 'node_modules/widgets/lib/B.svelte')
	);
});
afterAll(() => rmSync(app, { recursive: true, force: true }));

describe('discover_package_files over a partial install', () => {
	it('a dependency not installed and one whose manifest does not parse declare nothing', () => {
		expect(discover_package_files(app).map((p) => p.name)).toEqual(['widgets']);
	});

	it('a dangling symlink a glob matches is no file to list', () => {
		const widgets = discover_package_files(app).find((p) => p.name === 'widgets')!;
		expect(widgets.files).toEqual([`${app}/node_modules/widgets/lib/A.svelte`]);
	});

	it('a file a glob listed and that is gone before it is read is no file to list', () => {
		const real = fs.realpathSync;
		const spy = vi.spyOn(fs, 'realpathSync').mockImplementation(((p: fs.PathLike, o?: unknown) => {
			if (String(p).endsWith('A.svelte'))
				throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			return real(p, o as never);
		}) as typeof fs.realpathSync);
		try {
			expect(discover_package_files(app).flatMap((p) => p.files)).toEqual([]);
		} finally {
			spy.mockRestore();
		}
	});
});
