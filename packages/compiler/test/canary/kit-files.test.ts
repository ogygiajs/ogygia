/**
 * CANARY (#1718): the files and module ids inside SvelteKit that the compiler finds by path
 * (src/kit.ts) or by name (src/vite/index.ts), against every Kit the workspace installs. Each one
 * missing falls back without a word at build time, so it is checked here instead.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { broke, KITS, type Internal } from '../../../core/test/canary/upstream.ts';

const REMOTE: Internal = {
	upstream:
		"SvelteKit's remote functions client (`src/runtime/client/remote-functions/index.js`, `__sveltekit/remote`)",
	used_by: [
		'packages/compiler/src/kit.ts (kit_remote_index)',
		'packages/compiler/src/vite/index.ts (resolveId)'
	],
	issue: 1718
};
const WIRE: Internal = {
	upstream: "SvelteKit's remote key helper (`create_remote_key` in src/runtime/shared.js)",
	used_by: [
		'packages/compiler/src/kit.ts (kit_wire_path)',
		'packages/core/src/hooks.ts (the remote seed)'
	],
	issue: 1718
};
const PAGE: Internal = {
	upstream: "SvelteKit's client `page` state (status -1 until start, in `$state.raw` fields)",
	used_by: ['packages/core/src/runtime/kit-page-thread.svelte.ts'],
	issue: 1719
};

const read = (root: string, file: string) => {
	const at = path.join(root, file);
	return fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : null;
};

describe.each(Object.entries(KITS))('%s', (_, root) => {
	it('has the remote functions client, and its Vite plugin reaches it by `__sveltekit/remote` or by its path', () => {
		const index = 'src/runtime/client/remote-functions/index.js';
		expect(read(root, index), broke(REMOTE, `${index} is not there`)).not.toBeNull();
		const plugins = ['src/exports/vite/index.js', 'src/exports/vite/plugins/remote.js']
			.map((f) => read(root, f) ?? '')
			.join('\n');
		expect(
			plugins.includes("'__sveltekit/remote'") ||
				plugins.includes('client/remote-functions/index.js'),
			broke(REMOTE, 'its Vite plugin names neither `__sveltekit/remote` nor the client index')
		).toBe(true);
	});

	it('exports `create_remote_key` from src/runtime/shared.js', () => {
		const shared = read(root, 'src/runtime/shared.js');
		expect(shared, broke(WIRE, 'src/runtime/shared.js is not there')).not.toBeNull();
		expect(shared!, broke(WIRE, '`create_remote_key` is not exported there')).toMatch(
			/export function create_remote_key\(/
		);
	});

	it('builds its client page with status -1, the real status landing in a `$state.raw` field', () => {
		const state = ['src/runtime/client/state.svelte.js', 'src/runtime/app/state/client.svelte.js']
			.map((f) => read(root, f))
			.find((s) => s !== null && s.includes('status'));
		expect(state, broke(PAGE, 'no client page state file is there')).toBeTruthy();
		expect(
			state!,
			broke(PAGE, 'the client page no longer starts with `status = $state.raw(-1)`')
		).toContain('status = $state.raw(-1)');
	});
});
