import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import type { RenderConfig } from '../src/config.ts';
import { handoff_for, write_built } from '../src/vite/build-files.ts';
import { note_built } from '../src/store.ts';

vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

const CFG: RenderConfig = {
	formats: ['webp'],
	breakpoints: [],
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};

test('a watch rebuild after the build ended notes its prerender again', async () => {
	const handoff = await handoff_for(true);
	const output = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-out-'));
	await write_built(handoff, CFG, [], output);
	expect(() => note_built(handoff.minted, 'a-1x1/a.jpg.webp')).not.toThrow();
	expect(fs.readFileSync(handoff.minted, 'utf8')).toBe('a-1x1/a.jpg.webp\n');
});

test('a run a failed build left behind is removed by a later build, once a day old', async () => {
	const first = await handoff_for(true);
	const left = path.dirname(first.minted);
	const fresh = path.join(path.dirname(left), 'fresh-run');
	fs.mkdirSync(fresh, { recursive: true });
	const long_ago = new Date(Date.now() - 2 * 24 * 3600 * 1000);
	fs.utimesSync(left, long_ago, long_ago);
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const next = await handoff_for(true);
	expect(path.dirname(next.minted)).not.toBe(left);
	expect(fs.existsSync(left)).toBe(false);
	expect(fs.existsSync(fresh)).toBe(true);
	fs.rmSync(fresh, { recursive: true });
});
