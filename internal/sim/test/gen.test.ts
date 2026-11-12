// The random app (src/gen.ts): a seed always draws the same app, and what it writes is a page per
// plan entry and a component per region, each importing its children with their attributes.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { peer_plan, plan, write, write_peer, type GenNode } from '../src/gen.ts';

const all = (ns: readonly GenNode[]): GenNode[] => ns.flatMap((n) => [n, ...all(n.children)]);

describe('the random app', () => {
	it('a seed always draws the same app, and another seed another', () => {
		expect(plan(7)).toEqual(plan(7));
		expect(plan(7)).not.toEqual(plan(8));
	});

	it('writes a page per plan entry and a component per region, children imported with their attributes', () => {
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const pages = plan(3);
			write(app, pages, 3);
			const routes = readdirSync(join(app, 'src', 'routes'));
			for (const p of pages) expect(routes).toContain(p.path.slice(1));
			const nodes = all(pages.flatMap((p) => p.roots));
			const files = readdirSync(join(app, 'src', 'lib', 'gen'));
			const hosted = nodes.filter((n) => n.kind === 'held' || n.kind === 'live');
			expect(files.filter((f) => f.endsWith('.svelte'))).toHaveLength(nodes.length + hosted.length);
			expect(files.filter((f) => f.endsWith('.remote.ts'))).toHaveLength(hosted.length);
			const read = (f: string) => readFileSync(join(app, 'src', 'lib', 'gen', f), 'utf8');
			for (const n of nodes)
				for (const c of n.children) {
					const line = read(`N${n.id}.svelte`)
						.split('\n')
						.find((l) =>
							l.includes(`import ${c.kind === 'held' || c.kind === 'live' ? 'H' : 'N'}${c.id} `)
						)!;
					if (c.kind === 'hole') expect(line).toContain("render: 'deferred'");
					if (c.kind === 'lake') expect(line).toContain("wake: 'none'");
					if (c.kind === 'island') expect(line).toContain(`wake: '${c.wake}'`);
					if (c.kind === 'plain') expect(line).not.toContain(' with ');
					// (a held or live region: its host imported, the region's own schedule on the remote's
					// import of it)
					if (c.kind === 'held' || c.kind === 'live') {
						expect(line).toContain(`import H${c.id} `);
						expect(read(`h${c.id}.remote.ts`)).toContain(
							c.wake ? `with { wake: '${c.wake}' }` : "with { region: 'raw' }"
						);
					}
				}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it('draws held and live regions, never in place of a hole', () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		const nodes = seeds.flatMap((s) => all(plan(s).flatMap((p) => p.roots)));
		const kinds = new Set(nodes.map((n) => n.kind));
		expect(kinds).toContain('held');
		expect(kinds).toContain('live');
		expect(nodes.filter((n) => n.kind === 'hole').length).toBeGreaterThan(0);
	});

	it('draws a peer for some seeds, from its own stream: the app it serves is the same', () => {
		const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
		const peers = seeds.map((s) => peer_plan(s, plan(s)));
		expect(peers.filter(Boolean).length).toBeGreaterThan(0);
		expect(peers.filter((p) => p === null).length).toBeGreaterThan(0);
		const s = seeds[peers.findIndex(Boolean)];
		expect(peer_plan(s, plan(s))).toEqual(peer_plan(s, plan(s)));
		// (the peer's regions are numbered apart from the app's)
		const peer = peer_plan(s, plan(s))!;
		const ids = all([
			...peer.widgets.flatMap((w) => w.children),
			...peer.pages.flatMap((p) => p.roots)
		]);
		expect(ids.every((n) => n.id >= 1000)).toBe(true);
	});

	it("writes a peer's widgets, pages and federation, and the app's slots and mount", () => {
		const root = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		const app = join(root, 'app');
		try {
			const seed = Array.from({ length: 20 }, (_, i) => i + 1).find(
				(s) => (peer_plan(s, plan(s))?.slots.length ?? 0) > 0
			)!;
			const pages = plan(seed);
			const peer = peer_plan(seed, pages)!;
			write(app, pages, seed, peer);
			write_peer(`${app}-peer`, peer, seed);
			const lib = (dir: string, f: string) =>
				readFileSync(join(dir, 'src', 'lib', 'gen', f), 'utf8');
			const fed = lib(`${app}-peer`, 'federation.server.ts');
			for (const w of peer.widgets) expect(fed).toContain(`with { region: 'raw' }`);
			expect(fed).toContain('expose: router');
			for (const p of peer.pages) expect(lib(`${app}-peer`, 'router.ts')).toContain(`'${p.path}'`);
			const slot = peer.slots[0];
			const load = readFileSync(
				join(app, 'src', 'routes', slot.page.slice(1), '+page.server.ts'),
				'utf8'
			);
			expect(load).toContain(`peer.widget('${slot.widget}'`);
			expect(load).toContain(`render: '${slot.render}'`);
			expect(lib(app, 'mount.server.ts')).toContain(
				peer.mount === 'router' ? 'mount(peer)' : 'resolve(event)'
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('writes held and live regions with a remote module and a host', () => {
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const seed = Array.from({ length: 30 }, (_, i) => i + 1).find((s) =>
				all(plan(s).flatMap((p) => p.roots)).some((n) => n.kind === 'held')
			)!;
			write(app, plan(seed), seed);
			const n = all(plan(seed).flatMap((p) => p.roots)).find((x) => x.kind === 'held')!;
			const host = readFileSync(join(app, 'src', 'lib', 'gen', `H${n.id}.svelte`), 'utf8');
			expect(host).toContain(`from './h${n.id}.remote'`);
			expect(host).toContain('<Region of={');
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});
});
