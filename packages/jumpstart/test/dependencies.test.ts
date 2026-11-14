import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Dependencies } from '../src/dependencies.ts';

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A workspace: an app that installs `lib` as a link, `lib` linking `deep`, and a plain dependency. */
function workspace(): { root: string; app: string } {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-deps-')));
	made.push(root);
	const write = (rel: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), text);
	};
	write('lib/package.json', JSON.stringify({ name: 'lib', dependencies: { deep: '*' } }));
	write('deep/package.json', JSON.stringify({ name: 'deep' }));
	write(
		'lib/examples/app/package.json',
		JSON.stringify({ name: 'app', dependencies: { lib: '*' } })
	);
	write(
		'app/package.json',
		JSON.stringify({
			name: 'app',
			dependencies: { lib: '*', plain: '*' },
			devDependencies: { gone: '*' }
		})
	);
	write('app/node_modules/plain/package.json', JSON.stringify({ name: 'plain' }));
	fs.symlinkSync(path.join(root, 'lib'), path.join(root, 'app/node_modules/lib'), 'dir');
	fs.mkdirSync(path.join(root, 'lib/node_modules'));
	fs.symlinkSync(path.join(root, 'deep'), path.join(root, 'lib/node_modules/deep'), 'dir');
	fs.mkdirSync(path.join(root, 'lib/examples/app/node_modules'));
	fs.symlinkSync(
		path.join(root, 'lib'),
		path.join(root, 'lib/examples/app/node_modules/lib'),
		'dir'
	);
	return { root, app: path.join(root, 'app') };
}

describe('dependencies', () => {
	it("a linked package and the packages it links are dependencies, followed through each one's own", () => {
		const { root, app } = workspace();
		const d = new Dependencies(app);
		expect(d.linked).toEqual([`${root}/lib/`, `${root}/deep/`]);
		expect(d.has(`${root}/lib/src/index.js`)).toBe(true);
		expect(d.has(`${root}/deep/index.js`)).toBe(true);
		expect(d.has(`${root}/app/node_modules/plain/index.js`)).toBe(true);
		expect(d.has(`${root}/app/src/routes/+page.svelte`)).toBe(false);
	});

	it("an app inside the package it links is the app's code, the rest of that package a dependency", () => {
		const { root } = workspace();
		const d = new Dependencies(path.join(root, 'lib/examples/app'));
		expect(d.has(`${root}/lib/examples/app/src/lib/registry.ts`)).toBe(false);
		expect(d.has(`${root}/lib/src/index.js`)).toBe(true);
	});

	it('a directory with no package.json lists no dependency', () => {
		const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jumpstart-deps-')));
		made.push(dir);
		expect(new Dependencies(dir).linked).toEqual([]);
	});
});
