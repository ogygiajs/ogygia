// A seed is one run on any build of the same code. Two builds that differ only in their content
// hashes (Kit's version is the build's moment unless pinned; a scoped class read the checkout's
// folder) must draw the same fate for each request: the scheduled run's seed 610517457 failed on its
// runner and passed on every other host at the same commit, each a different run (#2110). The
// second build here is the first with every content hash renamed, as a rebuild under another
// stamp or folder gives. Needs the palaestra build.
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

/** Every file under `dir`, deepest first within each folder. */
function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const at = join(dir, name);
		return statSync(at).isDirectory() ? files(at) : [at];
	});
}

/** A file name's content hash: the 8 characters before its extension. */
const HASH = /(?:^|\.)([\w-]{8})\.(?:js|css)$/;

/** `output` copied with each content hash under `_app/immutable` renamed, its uses too. */
function rehashed(output: string): string {
	// (beside the build, so its server finds the app's packages)
	const copy = join(mkdtempSync(join(output, '..', 'sim-rehash-')), 'output');
	cpSync(output, copy, { recursive: true });
	const immutable = join(copy, 'client', '_app', 'immutable');
	const renamed = new Map<string, string>();
	for (const file of files(immutable)) {
		const hash = HASH.exec(file.slice(file.lastIndexOf('/') + 1))?.[1];
		if (hash === undefined || renamed.has(hash)) continue;
		renamed.set(
			hash,
			[...hash].reverse().join('') === hash ? `${hash.slice(1)}x` : [...hash].reverse().join('')
		);
	}
	const swap = (s: string): string => {
		for (const [from, to] of renamed) s = s.replaceAll(from, to);
		return s;
	};
	for (const file of files(copy)) {
		if (!/\.(js|mjs|cjs|css|html|json)$/.test(file)) continue;
		const text = readFileSync(file, 'utf8');
		const next = swap(text);
		if (next !== text) writeFileSync(file, next);
	}
	for (const file of files(immutable)) {
		const name = file.slice(file.lastIndexOf('/') + 1);
		const next = swap(name);
		if (next !== name) renameSync(file, join(file.slice(0, file.lastIndexOf('/')), next));
	}
	return copy;
}

/** What the network did to each request of a few visits on `output`, hashes left out. */
async function wire(output: string): Promise<string[]> {
	const world = await World.make({
		seed: 610517457,
		builds: [{ id: 'v1', output }],
		faults: new Set(['delay', 'drop', 'duplicate', 'cut', 'tamper', 'reorder', 'stall']),
		rates: { cut: 0.05, duplicate: 0.2 }
	});
	try {
		const tab = world.tab(world.visitor('v'));
		for (const path of ['/', '/data', '/nested', '/mixed', '/server-shared-cache', '/'])
			await world.go(tab, 'goto', path);
		await world.rest();
		// (every task the loop ran and every request, each file's hash, a signature and a document's
		// fingerprint, which reads them, left out)
		const plain = (line: string) =>
			line
				.replace(/([./])[\w-]{8}\.(js|css)\b/g, '$1#.$2')
				.replace(/\b(sig|k|pv)(=|%3D)[\w%-]+/g, '$1=#')
				.replace(/ dom [0-9a-f]+$/, ' dom #');
		return [
			...world.loop.log.map(plain),
			...world.network.exchanges.map((e) =>
				plain(`${e.at} ${e.from} ${e.method} ${e.url} ${e.status} ${e.cut} ${e.tampered}`)
			)
		];
	} finally {
		await world.end();
	}
}

describe.skipIf(!built)('a seed on two builds of the same code', () => {
	it('is one run though their content hashes differ', async () => {
		const copy = rehashed(OUTPUT);
		try {
			const a = await wire(OUTPUT);
			const b = await wire(copy);
			expect(a.length, 'the case it is for: the visits made requests').toBeGreaterThan(50);
			expect(b).toEqual(a);
		} finally {
			rmSync(join(copy, '..'), { recursive: true, force: true });
		}
	}, 300_000);
});
