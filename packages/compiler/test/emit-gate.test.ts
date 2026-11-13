import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
	island_host_loaded,
	parse_server_handoff,
	read_server_handoff,
	server_handoff_json,
	server_handoff_path
} from '../src/compiler/link/emit-gate.ts';
import { host_key } from '../src/compiler/program.ts';

// ─────────────────────────────────────────────────────────────────────────────
// The client-leg island emit gate. The prescan registers every marked import under src/ (both legs,
// same ids); the client leg must emit chunks only for islands whose HOST the server bundle actually
// contains. Regression: an app building a second route tree from the same source — the as-is build
// emitted the OTHER tree's boot islands, which imported a `.remote.ts` the server leg never analysed
// → Kit: "Expected to find metadata for remote file", build failed.
// ─────────────────────────────────────────────────────────────────────────────

const root = '/app';
const loaded = new Set([
	host_key(join(root, 'src/routes/+page.svelte')),
	host_key(join(root, 'src/lib/Host.svelte'))
]);

describe('island_host_loaded', () => {
	it('emits an island whose host the server leg transformed', () => {
		expect(island_host_loaded(join(root, 'src/routes/+page.svelte'), loaded)).toBe(true);
		// ids may carry a query / be unnormalised — same key rule as the registry
		expect(island_host_loaded(`${join(root, 'src/lib/Host.svelte')}?og-region`, loaded)).toBe(true);
	});

	it('skips an island whose host nothing in the server bundle imports', () => {
		expect(island_host_loaded(join(root, 'src/routes-v2/+page.svelte'), loaded)).toBe(false);
		expect(island_host_loaded(join(root, 'src/lib/catalog-v2/ProductBoot.svelte'), loaded)).toBe(
			false
		);
	});

	it('without a handoff (standalone / client-only build) every prescanned island is emitted', () => {
		expect(island_host_loaded(join(root, 'src/routes-v2/+page.svelte'), null)).toBe(true);
		expect(island_host_loaded(join(root, 'src/routes-v2/+page.svelte'), undefined)).toBe(true);
	});

	it('an island with no recorded host (bridge-registered library island) is always emitted', () => {
		expect(island_host_loaded(null, loaded)).toBe(true);
		expect(island_host_loaded(undefined, loaded)).toBe(true);
	});
});

describe('the handoff file', () => {
	it("lives under Kit outDir and round-trips the server leg's set and key", () => {
		expect(server_handoff_path('/app/.svelte-kit-v2')).toBe(
			'/app/.svelte-kit-v2/og-server-handoff.json'
		);
		const server_regions = [{ iid: 'r1', abs: join(root, 'lib/Slow.svelte') }];
		const handoff = parse_server_handoff(
			server_handoff_json([...loaded].sort(), 'k'.repeat(64), server_regions)
		);
		expect(handoff.hosts).toEqual(loaded);
		expect(handoff.build_key).toBe('k'.repeat(64));
		expect(handoff.server_regions).toEqual(server_regions);
	});

	it('tolerates a malformed handoff (nothing gated, never a throw on shape)', () => {
		const empty = { hosts: new Set(), build_key: '', server_regions: [] };
		expect(parse_server_handoff('{"not":"an array"}')).toEqual(empty);
		expect(parse_server_handoff('null')).toEqual(empty);
		const mixed = parse_server_handoff(
			JSON.stringify({
				hosts: [1, null, '/a/b.svelte'],
				build_key: 7,
				server_regions: [null, { iid: 'r1' }, { iid: 'r2', abs: '/a/c.svelte' }]
			})
		);
		expect(mixed).toEqual({
			hosts: new Set(['/a/b.svelte']),
			build_key: '',
			server_regions: [{ iid: 'r2', abs: '/a/c.svelte' }]
		});
	});

	it('reads as none when the server leg wrote nothing', () => {
		expect(read_server_handoff('/nonexistent-ogygia-out')).toBeNull();
	});
});
