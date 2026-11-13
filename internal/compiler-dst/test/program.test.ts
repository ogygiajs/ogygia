// The program's region records (packages/compiler/src/compiler/program.ts), through the in-memory
// dev server: what serving a host registers, what an edit that drops a mark lets go (only when no
// other host still holds the region), and the runtime marks each kind of region turns on.
import { describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { LIB, ROUTES } from '../src/app.ts';
import { dev_server, edit, type Server } from '../src/dev.ts';
import { session } from '../src/session.ts';
import { memory_fs } from '../../../packages/compiler/src/compiler/fs.ts';

const A = `${ROUTES}/a/+page.svelte`;
const B = `${ROUTES}/b/+page.svelte`;
const C = `${ROUTES}/c/+page.svelte`;

/** A page that imports `Counter` with `attrs` (none: a plain import). */
const page = (attrs = `wake: 'visible'`) => dedent`
	<script>
		import Counter from '$lib/Counter.svelte'${attrs ? ` with { ${attrs} }` : ''};
	</script>
	<Counter />
`;

/** A dev server on an app whose pages sit under a csr=false layout (so their regions register),
 *  every page served once. */
async function served(pages: Record<string, string>): Promise<Server> {
	const dev = dev_server({
		[`${LIB}/Counter.svelte`]: '<button>+</button>\n',
		[`${ROUTES}/+layout.ts`]: 'export const csr = false;\n',
		...pages
	});
	await dev.serve();
	return dev;
}

/** Save `file` as `text` and load the page again. */
async function save(dev: Server, file: string, text: string): Promise<void> {
	edit(dev, file, text);
	await dev.serve();
}

/** What the program holds of `Counter`'s regions. */
function held(dev: Server) {
	const p = dev.s.compiler.program;
	const rows = [...p.registry].filter(([, e]) => e.componentPath?.endsWith('/Counter.svelte'));
	const ids = [...new Set(rows.map(([, e]) => e.id))].sort();
	return {
		roles: rows.map(([, e]) => e.role).sort(),
		in_graph: rows.filter(([v]) => p.island_graph.has(v)).length,
		ids,
		kinds: ids.map((id) => p.region_kinds.get(id)),
		by_id: ids.filter((id) => p.by_id.has(id)).length
	};
}

describe('a host', () => {
	it("a wake import registers the region's four rows, each in the island graph", async () => {
		const h = held(await served({ [A]: page() }));
		expect(h.roles).toEqual(['entry', 'lazy', 'region', 'wrapper']);
		expect(h.in_graph).toBe(4);
		expect(h.kinds).toEqual(['hydrate']);
		expect(h.by_id).toBe(1);
	});

	it('edited to drop the mark lets the region go', async () => {
		const dev = await served({ [A]: page() });
		const { ids } = held(dev);
		await save(dev, A, page(''));
		expect(held(dev)).toEqual({ roles: [], in_graph: 0, ids: [], kinds: [], by_id: 0 });
		for (const id of ids) expect(dev.s.compiler.program.region_kinds.has(id)).toBe(false);
		expect([...dev.s.compiler.program.island_graph].filter((v) => v.startsWith('ogygia:'))).toEqual(
			[]
		);
	});

	it('one of two hosts of a region dropping it keeps it; both dropping it lets it go', async () => {
		const dev = await served({ [A]: page(), [B]: page() });
		const both = held(dev);
		expect(both.ids).toHaveLength(1);
		await save(dev, A, page(''));
		expect(held(dev)).toEqual(both);
		await save(dev, B, page(''));
		expect(held(dev).roles).toEqual([]);
		expect(dev.s.compiler.program.region_kinds.has(both.ids[0]!)).toBe(false);
		expect(dev.s.compiler.program.by_id.has(both.ids[0]!)).toBe(false);
	});

	it('edited to a new wake moves the region to its new id', async () => {
		const dev = await served({ [A]: page() });
		const [before] = held(dev).ids;
		await save(dev, A, page(`wake: 'idle'`));
		const after = held(dev);
		expect(after.ids).toHaveLength(1);
		expect(after.ids[0]).not.toBe(before);
		expect(after.roles).toEqual(['entry', 'lazy', 'region', 'wrapper']);
		expect(dev.s.compiler.program.region_kinds.has(before!)).toBe(false);
	});

	it('a server island is a server entry with its render id; a lake is a lake', async () => {
		const dev = await served({ [A]: page(`render: 'deferred'`) });
		const p = dev.s.compiler.program;
		const entry = [...p.registry.values()].find(
			(e) => e.role === 'entry' && e.componentPath?.endsWith('/Counter.svelte')
		);
		expect(entry).toMatchObject({ server: true, portable: false });
		expect(entry!.renderId).toMatch(/\S/);
		expect(held(dev).kinds).toEqual(['defer']);
		await save(dev, A, page(`wake: 'none'`));
		expect(held(dev).kinds).toEqual(['lake']);
	});
});

describe('the runtime marks', () => {
	const marks = async (pages: Record<string, string>) =>
		(await served(pages)).s.compiler.program.runtime_marks;

	it('every wake the pages use, once each', async () => {
		const m = await marks({
			[A]: page(`wake: 'visible'`),
			[B]: page(`wake: 'idle'`),
			[C]: page(`wake: 'idle'`)
		});
		expect([...(m.hydrate ?? [])].sort()).toEqual(['idle', 'visible']);
	});

	it("every deferred region's fetch timing, once each", async () => {
		const m = await marks({
			[A]: page(`render: 'deferred', fetch: 'visible'`),
			[B]: page(`render: 'deferred'`),
			[C]: page(`render: 'deferred'`)
		});
		expect([...(m.defer ?? [])].sort()).toEqual(['load', 'visible']);
	});

	it('a lake marks lakes and the none wake', async () => {
		const m = await marks({ [A]: page(`wake: 'none'`) });
		expect(m.lakes).toBe(true);
		expect(m.hydrate).toEqual(['none']);
	});

	it('a kept island marks persistence and its key, once', async () => {
		const m = await marks({
			[A]: page(`wake: 'load', keep: 'player'`),
			[B]: page(`wake: 'load', keep: 'player'`)
		});
		expect(m.persist).toBe(true);
		expect(m.persistKeys).toEqual(['player']);
	});

	it('a plain wake island turns on none of live, morph, persist, lakes', async () => {
		const m = await marks({ [A]: page() });
		expect([m.live, !!m.morph, !!m.persist, m.lakes]).toEqual([false, false, false, false]);
		expect(m.defer).toEqual([]);
	});

	it('a held region from a module turns on live and morph', async () => {
		const m = await marks({
			[`${ROUTES}/+page.ts`]: dedent`
				import Counter from '$lib/Counter.svelte' with { region: 'raw' };
				export const load = () => ({ r: Counter });
			`
		});
		expect([m.live, m.morph]).toEqual([true, true]);
	});
});

describe('a fresh program', () => {
	it('starts incomplete, with no remote seeds, no wire, no page reads and no feature hash', () => {
		const p = session(memory_fs({ [A]: page() })).compiler.program;
		expect(p.runtime_marks.complete).toBe(false);
		expect(p.runtime_marks.remoteSeeds).toBe(false);
		expect(p.crosses_wire).toBe(false);
		expect(p.island_reads_page).toBe(false);
		expect(p.runtime_feature_hash).toBe('');
	});
});
