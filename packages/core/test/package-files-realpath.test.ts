// `ogygia.files` STAYS INSIDE ITS PACKAGE (vite/package-files.ts): a path escaping it would widen the
// compile surface to unrelated code. The boundary holds for the path a file really has: a symlink
// inside the package that leads out of it is outside.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover_package_files } from '../src/vite/package-files.ts';

const made: string[] = [];
afterEach(() => {
	for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function app_with_linked_package(entry: string) {
	const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-pkgfiles-')));
	made.push(tmp);
	const outside = path.join(tmp, 'outside');
	fs.mkdirSync(outside, { recursive: true });
	fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const x = 1;');
	const app = path.join(tmp, 'app');
	const pkg = path.join(app, 'node_modules', 'some-pkg');
	fs.mkdirSync(pkg, { recursive: true });
	fs.writeFileSync(
		path.join(app, 'package.json'),
		JSON.stringify({ dependencies: { 'some-pkg': '1.0.0' } })
	);
	fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ ogygia: { files: [entry] } }));
	// a link INSIDE the package that leads OUT of it
	fs.symlinkSync(outside, path.join(pkg, 'linked'));
	return { app, outside };
}

describe('ogygia.files: the package boundary', () => {
	it('a symlinked directory leading out of the package is not compile surface', () => {
		const { app, outside } = app_with_linked_package('./linked');
		let scans: ReturnType<typeof discover_package_files> = [];
		try {
			scans = discover_package_files(app);
		} catch {
			return; // refusing the declaration is a fine answer too
		}
		const dirs = scans.flatMap((s) => s.dirs);
		expect(dirs.some((d) => d.startsWith(outside))).toBe(false);
	});

	it('a glob through a symlink leading out of the package lists no outside file', () => {
		const { app, outside } = app_with_linked_package('./linked/**/*.ts');
		const files = discover_package_files(app).flatMap((s) => s.files);
		expect(files.some((f) => f.startsWith(outside))).toBe(false);
	});
});
