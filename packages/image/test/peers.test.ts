// A native peer (sharp, or a card engine package) counts as the app's only when the app installs it:
// found from the app in a node_modules folder at or above it, not only through NODE_PATH (pnpm's bin
// shims point it at the whole store). One check serves sharp and the card engine alike.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { peer_state } from '../src/vite/peers.ts';

const FOUND = vi.hoisted(() => ({ prefix: 'og-image-peers-', entry: '' }));

vi.mock('node:module', async (original) => {
	const real = await original<{ createRequire: (from: string | URL) => NodeJS.Require }>();
	const createRequire = (from: string | URL): NodeJS.Require => {
		const req = real.createRequire(from);
		if (!String(from).includes(FOUND.prefix)) return req;
		const resolve = ((id: string) => {
			if (id === 'satori') return FOUND.entry;
			return req.resolve(id);
		}) as NodeJS.RequireResolve;
		return Object.assign(((id: string) => req(id)) as NodeJS.Require, req, { resolve });
	};
	return { ...real, default: { ...real, createRequire }, createRequire };
});

FOUND.entry = createRequire(import.meta.url).resolve('satori');

test('with NODE_PATH set, a card engine package Node finds with no node_modules folder at or above the app is not the app installing it', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), FOUND.prefix));
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ name: 'app', private: true, dependencies: { satori: '^0.33.0' } })
	);
	const node_path = process.env.NODE_PATH;
	process.env.NODE_PATH = path.dirname(FOUND.entry);
	try {
		expect(peer_state(root, ['satori'])).toEqual({
			installed: false,
			listed: 'dependencies',
			missing: ['satori']
		});
		delete process.env.NODE_PATH;
		expect(peer_state(root, ['satori']).installed).toBe(true);
	} finally {
		if (node_path === undefined) delete process.env.NODE_PATH;
		else process.env.NODE_PATH = node_path;
	}
});

test('the least place any peer is listed counts', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-peers-listed-'));
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ dependencies: { satori: '1' }, devDependencies: { 'satori-html': '1' } })
	);
	expect(peer_state(root, ['satori', 'satori-html']).listed).toBe('dev');
	expect(peer_state(root, ['satori', '@resvg/resvg-js']).listed).toBe('none');
});
