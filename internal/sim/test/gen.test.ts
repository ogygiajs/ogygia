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
			expect(files.filter((f) => f.endsWith('.svelte'))).toHaveLength(nodes.length);
			for (const n of nodes)
				for (const c of n.children) {
					const source = readFileSync(join(app, 'src', 'lib', 'gen', `N${n.id}.svelte`), 'utf8');
					const line = source.split('\n').find((l) => l.includes(`import N${c.id} `))!;
					if (c.kind === 'hole') expect(line).toContain("render: 'deferred'");
					if (c.kind === 'lake') expect(line).toContain("wake: 'none'");
					if (c.kind === 'island') expect(line).toContain(`wake: '${c.wake}'`);
					if (c.kind === 'plain') expect(line).not.toContain(' with ');
				}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});
});
