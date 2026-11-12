// The random app (src/gen.ts): a seed always draws the same app, and what it writes is a page per
// plan entry and a component per region, each importing its children with their attributes.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { plan, write, type GenNode } from '../src/gen.ts';

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
