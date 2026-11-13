// A compile with no Kit to read (a standalone compile, or a broken install): Kit's paths and major
// version read as none, and nothing throws.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { kit_major, resolve_kit_paths } from '../src/compiler/kit.ts';

const made: string[] = [];
const dir = () => {
	const d = mkdtempSync(path.join(tmpdir(), 'og-no-kit-'));
	made.push(d);
	return d;
};
afterAll(() => {
	for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('no Kit resolves from the app root', () => {
	it("a Kit that does not resolve (its manifest not exported) has none of Kit's paths", () => {
		const root = dir();
		const kit = path.join(root, 'node_modules', '@sveltejs', 'kit');
		mkdirSync(kit, { recursive: true });
		writeFileSync(
			path.join(kit, 'package.json'),
			JSON.stringify({ name: '@sveltejs/kit', version: '2.0.0', exports: { '.': './index.js' } })
		);
		const paths = resolve_kit_paths(root);
		expect(paths.kit_wire_path).toBe(null);
		expect(paths.kit_remote_index).toBe(null);
		expect(paths.kit_transport_init).toBe(null);
	});

	it('a Kit whose package.json does not parse has no major version', () => {
		const root = dir();
		const kit = path.join(root, 'node_modules', '@sveltejs', 'kit');
		mkdirSync(kit, { recursive: true });
		writeFileSync(path.join(kit, 'package.json'), '{"name": "@sveltejs/kit", "version": ');
		expect(kit_major(root)).toBe(null);
	});
});
