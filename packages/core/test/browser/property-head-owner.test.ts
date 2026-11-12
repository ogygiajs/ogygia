// After a navigation's swap, the head nodes the next page does not list (`unlisted`) go, but for
// those a region still on the page uses (a region sheet, #275) or owns (`data-og-owner` naming its
// fingerprint, #806): runtime/region-sheets.ts `release_head_nodes`. Over any mix of regions (on the
// page or gone), owners (none, empty, matching, unknown) and sheet use: a node stays exactly when a
// region on the page uses or owns it, and a node not in `unlisted` is never touched.
import { afterEach, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { release_head_nodes, use_sheets } from '../../src/runtime/region-sheets.ts';
import { connected_regions } from '../../src/runtime/connected.ts';

const made: Element[] = [];
function track<T extends Element>(el: T): T {
	made.push(el);
	return el;
}
function cleanup(): void {
	for (const el of made.splice(0)) {
		connected_regions.delete(el);
		el.remove();
	}
}
afterEach(cleanup);

const FPS = ['f1', 'f2', 'f3'];
const region_spec = fc.record({
	fp: fc.constantFrom(...FPS, ''),
	on_page: fc.boolean(),
	/** indexes into the head nodes this region's answer uses */
	uses: fc.array(fc.nat({ max: 7 }), { maxLength: 3 })
});
const node_spec = fc.record({
	owner: fc.option(fc.constantFrom(...FPS, '', 'unknown', ' f1', 'unknown f2', 'f1 f3'), {
		nil: null
	}),
	unlisted: fc.boolean()
});

it('a head node the next page does not list stays exactly while a region on the page uses or owns it', () => {
	fc.assert(
		fc.property(
			fc.array(region_spec, { maxLength: 5 }),
			fc.array(node_spec, { minLength: 1, maxLength: 8 }),
			(regions, specs) => {
				cleanup();
				const nodes = specs.map((s) => {
					const meta = track(document.createElement('meta'));
					meta.setAttribute('name', 'x-test');
					if (s.owner !== null) meta.setAttribute('data-og-owner', s.owner);
					document.head.append(meta);
					return meta;
				});
				const live = new Set<Element>();
				const owners = new Set<string>();
				for (const r of regions) {
					const el = track(document.createElement('div'));
					if (r.fp) el.setAttribute('data-og-fp', r.fp);
					document.body.append(el);
					connected_regions.add(el);
					const used = r.uses.filter((i) => i < nodes.length).map((i) => nodes[i]!);
					use_sheets(el, used);
					// a region gone from the page: out of the document, its teardown not run yet
					if (!r.on_page) el.remove();
					else {
						for (const n of used) live.add(n);
						if (r.fp) owners.add(r.fp);
					}
				}
				release_head_nodes(nodes.filter((_, i) => specs[i]!.unlisted));
				nodes.forEach((n, i) => {
					const s = specs[i]!;
					// (`data-og-owner` is a space-separated list of owners, #854)
					const named = (s.owner ?? '').split(' ').filter(Boolean);
					const kept = !s.unlisted || live.has(n) || named.some((o) => owners.has(o));
					expect(n.isConnected, `node ${i}`).toBe(kept);
				});
			}
		),
		{ numRuns: 300 }
	);
});
