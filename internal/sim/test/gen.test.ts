// The random app (src/gen.ts): a seed always draws the same app, and what it writes is a page per
// plan entry and a component per region, each importing its children with their attributes.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	LAYOUT_FIRST,
	layout_plan,
	peer_plan,
	plan,
	router_plan,
	shape_plan,
	write,
	write_peer,
	type GenNode,
	type GenPage
} from '../src/gen.ts';

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
			// (a live region that switches has two more: another interactive module and a static one)
			const switching = nodes.filter((n) => n.switches).length;
			expect(files.filter((f) => f.endsWith('.svelte'))).toHaveLength(
				nodes.length + hosted.length + 2 * switching
			);
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

	it('some root holes with a fallback keep it, and no other region does', () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		const pages = seeds.flatMap((s) => plan(s));
		const kept = all(pages.flatMap((p) => p.roots)).filter((n) => n.keep);
		expect(kept.length).toBeGreaterThan(0);
		const roots = new Set(pages.flatMap((p) => p.roots));
		for (const n of kept) {
			expect(roots.has(n)).toBe(true);
			expect([n.kind, n.fallback]).toEqual(['hole', true]);
		}
	});

	it("some pages are stored (postrender), and say so in Kit's config", () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		const pages = seeds.flatMap((s) => plan(s));
		const stored = pages.filter((p) => p.postrender);
		expect(stored.length).toBeGreaterThan(0);
		expect(stored.length).toBeLessThan(pages.length);
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			// (a stored page with no peer slot says so in a +page.ts of its own, or beside its data's
			// load when it has one)
			const seed = seeds.find((s) => plan(s).some((p) => p.postrender))!;
			const drawn = plan(seed);
			write(app, drawn, seed);
			for (const p of drawn) {
				const at = join(app, 'src', 'routes', p.path.slice(1));
				const files = readdirSync(at);
				if (!p.postrender) expect(files).not.toContain('+page.ts');
				else
					expect(
						readFileSync(join(at, p.data || p.flagged ? '+page.server.ts' : '+page.ts'), 'utf8')
					).toContain('export const config = { postrender: true };');
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it("some islands' markup changes in the next release, and nothing else's", () => {
		const nodes = Array.from({ length: 30 }, (_, i) => plan(i + 1)).flatMap((pages) =>
			all(pages.flatMap((p) => p.roots))
		);
		const changing = nodes.filter((n) => n.changes);
		expect(changing.length).toBeGreaterThan(0);
		for (const n of changing) expect(n.kind).toBe('island');
		const seed = Array.from({ length: 30 }, (_, i) => i + 1).find((s) =>
			all(plan(s).flatMap((p) => p.roots)).some((n) => n.changes)
		)!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const pages = plan(seed);
			write(app, pages, seed);
			for (const n of all(pages.flatMap((p) => p.roots))) {
				const src = readFileSync(join(app, 'src', 'lib', 'gen', `N${n.id}.svelte`), 'utf8');
				expect(src.includes("VITE_SIM_BUILD === 'v2'")).toBe(n.changes === true);
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
			for (const w of peer.widgets)
				expect(fed).toContain(
					`import W${w.name} from './W${w.name}.svelte' with { region: 'raw' }`
				);
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

	it('a federated app registers its federation from its hook, so a server that never served the mount still answers its holes (gen 220 seed 19)', () => {
		const root = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
			for (const mount of ['router', 'kit'] as const) {
				const seed = seeds.find((s) => peer_plan(s, plan(s))?.mount === mount)!;
				const app = join(root, mount);
				write(app, plan(seed), seed, peer_plan(seed, plan(seed)));
				expect(readFileSync(join(app, 'src', 'lib', 'gen', 'mount.server.ts'), 'utf8')).toMatch(
					/^import .*'\.\/federation\.server\.ts';$/m
				);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("draws live regions that switch, from their own stream: ticks cycle through the region's own module, another interactive one and a static one", () => {
		const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
		const lives = seeds.flatMap((s) =>
			all(plan(s).flatMap((p) => p.roots)).filter((n) => n.kind === 'live')
		);
		expect(lives.some((n) => n.switches)).toBe(true);
		expect(lives.some((n) => !n.switches)).toBe(true);
		for (const s of seeds)
			for (const n of all(plan(s).flatMap((p) => p.roots)))
				if (n.switches) expect(n.kind).toBe('live');
		const seed = seeds.find((s) => all(plan(s).flatMap((p) => p.roots)).some((n) => n.switches))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			const n = all(plan(seed).flatMap((p) => p.roots)).find((x) => x.switches)!;
			const lib = join(app, 'src', 'lib', 'gen');
			const remote = readFileSync(join(lib, `h${n.id}.remote.ts`), 'utf8');
			expect(remote).toContain(`import A${n.id} from './A${n.id}.svelte' with { wake: 'load' };`);
			expect(remote).toContain(`import S${n.id} from './S${n.id}.svelte' with { region: 'raw' };`);
			expect(remote).toContain(`[N${n.id}, A${n.id}, S${n.id}][n % 3]`);
			expect(readFileSync(join(lib, `A${n.id}.svelte`), 'utf8')).toContain('<button');
			expect(readFileSync(join(lib, `S${n.id}.svelte`), 'utf8')).not.toContain('<button');
		} finally {
			rmSync(app, { recursive: true, force: true });
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

	it("draws regions' stylesheets, kept hole renders, dated island props and page data, each where it can be", () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		const pages = seeds.flatMap((s) => plan(s));
		const nodes = all(pages.flatMap((p) => p.roots));
		for (const f of ['style', 'maxAge', 'dated', 'reads', 'refresh'] as const)
			expect(nodes.some((n) => n[f] !== undefined)).toBe(true);
		for (const n of nodes) {
			if (n.maxAge) expect([n.kind, n.keep]).toEqual(['hole', undefined]);
			if (n.dated) expect(n.kind).toBe('island');
			if (n.refresh) expect([n.kind, n.reads]).toEqual(['island', true]);
		}
		// (a region reads page data only on a page that has it)
		for (const p of pages) if (!p.data) expect(all(p.roots).some((n) => n.reads)).toBe(false);
		const seed = seeds.find((s) => {
			const ns = all(plan(s).flatMap((p) => p.roots));
			return ns.some((n) => n.maxAge) && ns.some((n) => n.dated) && ns.some((n) => n.reads);
		})!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const drawn = plan(seed);
			write(app, drawn, seed);
			const read = (f: string) => readFileSync(join(app, 'src', 'lib', 'gen', f), 'utf8');
			const route = (p: string, f: string) =>
				readFileSync(join(app, 'src', 'routes', p.slice(1), f), 'utf8');
			for (const p of drawn) {
				if (p.data)
					expect(route(p.path, '+page.server.ts')).toContain(`who: '${p.path.slice(1)} data'`);
				const users = [
					route(p.path, '+page.svelte'),
					...all(p.roots).map((n) => read(`N${n.id}.svelte`))
				];
				for (const n of all(p.roots)) {
					const src = read(`N${n.id}.svelte`);
					expect(src.includes('<style>')).toBe(n.style === true);
					expect(src.includes('page.data.who')).toBe(n.reads === true);
					expect(src.includes('invalidateAll()')).toBe(n.refresh === true);
					// (a kept render is a preset's, never an inline maxAge: the compiler refuses one)
					const used = users
						.join('\n')
						.split('\n')
						.find((l) => l.includes(`import N${n.id} `));
					if (n.maxAge) expect(used).toContain(`preset: 'hole-${n.maxAge}`);
					expect(used ?? '').not.toContain('maxAge');
					if (n.dated)
						expect(users.join('\n')).toContain(`<N${n.id} label="n${n.id}" since={new Date(`);
				}
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it("draws the peer's region stylesheets and its pages' loads", () => {
		const seed = Array.from({ length: 40 }, (_, i) => i + 1).find((s) => {
			const q = peer_plan(s, plan(s));
			return q !== null && q.pages.some((p) => p.data) && q.pages.some((p) => !p.data);
		})!;
		const peer = peer_plan(seed, plan(seed))!;
		const nodes = all([
			...peer.widgets.flatMap((w) => w.children),
			...peer.pages.flatMap((p) => p.roots)
		]);
		expect(nodes.some((n) => n.style)).toBe(true);
		const root = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write_peer(join(root, 'peer'), peer, seed);
			const lib = (f: string) => readFileSync(join(root, 'peer', 'src', 'lib', 'gen', f), 'utf8');
			for (const n of nodes)
				expect(lib(`N${n.id}.svelte`).includes('<style>')).toBe(n.style === true);
			for (const [i, p] of peer.pages.entries()) {
				expect(lib('router.ts').includes(`page(Q${i}, { load:`)).toBe(p.data === true);
				expect(lib(`Q${i}.svelte`).includes('{data.who}')).toBe(p.data === true);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('draws messy parts where each can be: odd text, big props, a throwing hole with a fallback, a lake with bad HTML', () => {
		const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
		const nodes = seeds.flatMap((s) => all(plan(s).flatMap((p) => p.roots)));
		for (const f of ['odd', 'big', 'throws', 'bad'] as const)
			expect(nodes.some((n) => n[f] === true)).toBe(true);
		for (const n of nodes) {
			if (n.big) expect(n.kind).toBe('island');
			if (n.throws) expect([n.kind, n.fallback, n.keep]).toEqual(['hole', true, undefined]);
			if (n.bad) expect(n.kind).toBe('lake');
		}
		const seed = seeds.find((s) => all(plan(s).flatMap((p) => p.roots)).some((n) => n.bad))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			for (const n of all(plan(seed).flatMap((p) => p.roots))) {
				const src = readFileSync(join(app, 'src', 'lib', 'gen', `N${n.id}.svelte`), 'utf8');
				// (what it writes badly says so: the HTML oracle leaves it to the app)
				expect(src.includes('data-gen-messy')).toBe(n.bad === true);
				expect(src.includes('throw new Error')).toBe(n.throws === true);
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it('draws a layout region tree for some seeds, from its own stream: a styled hole on every page, which a router navigation keeps', () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		const drawn = seeds.map((s) => layout_plan(s));
		expect(drawn.some((l) => l === null)).toBe(true);
		expect(drawn.some((l) => l !== null)).toBe(true);
		for (const l of drawn) {
			if (l === null) continue;
			// (a hole whose answer lifts its sheet into the head, numbered apart from the pages' regions)
			expect([l.kind, l.style, l.id]).toEqual(['hole', true, LAYOUT_FIRST]);
			for (const n of all([l])) expect(n.id).toBeGreaterThanOrEqual(LAYOUT_FIRST);
		}
		const seed = seeds.find((s) => {
			const l = layout_plan(s);
			return l !== null && l.children.length > 0;
		})!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const layout = layout_plan(seed)!;
			write(app, plan(seed), seed, null, layout);
			const src = readFileSync(join(app, 'src', 'routes', '+layout.svelte'), 'utf8');
			expect(src).toContain(
				`import N${layout.id} from '$lib/gen/N${layout.id}.svelte'${layout.wake ? ` with { render: 'deferred', wake: '${layout.wake}' }` : ` with { render: 'deferred' }`};`
			);
			// (after the nav, before the page: the same element on every page)
			expect(src.indexOf(`<N${layout.id} `)).toBeGreaterThan(src.indexOf('</nav>'));
			expect(src.indexOf(`<N${layout.id} `)).toBeLessThan(src.indexOf('{@render children()}'));
			const lib = join(app, 'src', 'lib', 'gen');
			for (const n of all([layout]))
				expect(readFileSync(join(lib, `N${n.id}.svelte`), 'utf8').includes('<style>')).toBe(
					n.style === true
				);
			expect(JSON.parse(readFileSync(join(lib, 'plan.json'), 'utf8')).layout).toEqual(layout);
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it("draws an app without the router for some seeds, from its own stream: plan.json says so and the app's vite config reads it", () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		expect(seeds.some((s) => router_plan(s))).toBe(true);
		expect(seeds.some((s) => !router_plan(s))).toBe(true);
		const seed = seeds.find((s) => !router_plan(s))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed, null, null, false);
			const written = JSON.parse(readFileSync(join(app, 'src', 'lib', 'gen', 'plan.json'), 'utf8'));
			expect(written.router).toBe(false);
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
		const config = readFileSync(
			join(import.meta.dirname, '../../../apps/sim-gen/vite.config.ts'),
			'utf8'
		);
		expect(config).toContain("'src/lib/gen/plan.json'");
		expect(config).toContain('router: plan.router !== false');
	});

	it('draws a flag some pages read on the server, from its own stream: each read is an exposure the sink takes in batches', () => {
		const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
		const pages = seeds.flatMap((s) => plan(s));
		expect(pages.some((p) => p.flagged)).toBe(true);
		expect(pages.some((p) => !p.flagged)).toBe(true);
		const seed = seeds.find((s) => plan(s).some((p) => p.flagged))!;
		const plain = seeds.find((s) => !plan(s).some((p) => p.flagged))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(plain), plain);
			const lib = join(app, 'src', 'lib', 'gen');
			// (the hooks import it either way: an app with no flag has an empty module)
			expect(readFileSync(join(lib, 'flags.server.ts'), 'utf8')).not.toContain('flag(');
			write(app, plan(seed), seed);
			const flags = readFileSync(join(lib, 'flags.server.ts'), 'utf8');
			expect(flags).toContain("export const gate = flag('gen-gate');");
			expect(flags).toContain('decide({ exposure:');
			for (const p of plan(seed)) {
				const dir = join(app, 'src', 'routes', p.path.slice(1));
				const page = readFileSync(join(dir, '+page.svelte'), 'utf8');
				expect(page.includes('data-gen-flag')).toBe(p.flagged === true);
				if (p.flagged)
					expect(readFileSync(join(dir, '+page.server.ts'), 'utf8')).toContain('gate: gate(event)');
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
		const root = join(import.meta.dirname, '../../../apps/sim-gen');
		expect(readFileSync(join(root, 'src/hooks.server.ts'), 'utf8')).toContain(
			"import '$lib/gen/flags.server';"
		);
		expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain('flags()');
	});

	it('draws a hero image on some pages, from its own stream: the critical wait has a resource to wait for', () => {
		const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
		const pages = seeds.flatMap((s) => plan(s));
		expect(pages.some((p) => p.hero)).toBe(true);
		expect(pages.some((p) => !p.hero)).toBe(true);
		// (the trees stay what they were: the hero is drawn apart)
		const strip = (ps: readonly GenPage[]) =>
			ps.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'hero')));
		expect(strip(plan(3))).toEqual(strip(plan(3)));
		const seed = seeds.find((s) => plan(s).some((p) => p.hero))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const drawn = plan(seed);
			write(app, drawn, seed);
			for (const p of drawn) {
				const src = readFileSync(
					join(app, 'src', 'routes', p.path.slice(1), '+page.svelte'),
					'utf8'
				);
				expect(src.includes('<img src="/hero.png" fetchpriority="high"')).toBe(p.hero === true);
			}
			const image = readFileSync(join(app, 'src', 'routes', 'hero.png', '+server.ts'), 'utf8');
			expect(image).toContain("'content-type': 'image/png'");
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it("draws a module of the page's own after ogygia's runtime on some pages, from its own stream: DOMContentLoaded waits for its download", () => {
		const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
		const pages = seeds.flatMap((s) => plan(s));
		expect(pages.some((p) => p.late)).toBe(true);
		expect(pages.some((p) => !p.late)).toBe(true);
		const seed = seeds.find((s) => plan(s).some((p) => p.late))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const drawn = plan(seed);
			write(app, drawn, seed);
			for (const p of drawn) {
				const src = readFileSync(
					join(app, 'src', 'routes', p.path.slice(1), '+page.svelte'),
					'utf8'
				);
				// (parsed with the page, so the browser runs it; spelled so the component's own parser
				// never meets a closing script tag)
				expect(src.includes(`type="module" src="/late.js"`)).toBe(p.late === true);
			}
			const module = readFileSync(join(app, 'src', 'routes', 'late.js', '+server.ts'), 'utf8');
			expect(module).toContain("'content-type': 'text/javascript'");
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it("draws islands a third party's script changes while they sleep, from their own stream: one that wakes on its own, in the page's own HTML", () => {
		const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
		const touched: GenNode[] = [];
		const under = (ns: readonly GenNode[], page: boolean): void => {
			for (const n of ns) {
				if (n.thirdParty) {
					touched.push(n);
					// (in the page's own HTML: an answer's or a lake's script is another story)
					expect(page).toBe(true);
				}
				under(n.children, page && (n.kind === 'island' || n.kind === 'plain'));
			}
		};
		for (const s of seeds) for (const p of plan(s)) under(p.roots, true);
		expect(touched.length).toBeGreaterThan(0);
		for (const n of touched) {
			expect(n.kind).toBe('island');
			// (woken by rest: one still asleep after a router visit, whose script is inert, would differ)
			expect(['load', 'idle']).toContain(n.wake);
			expect(n.empty).toBeFalsy();
		}
		const seed = seeds.find((s) => all(plan(s).flatMap((p) => p.roots)).some((n) => n.thirdParty))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			const lib = join(app, 'src', 'lib', 'gen');
			const files = [
				...readdirSync(lib)
					.filter((f) => f.endsWith('.svelte'))
					.map((f) => readFileSync(join(lib, f), 'utf8')),
				...readdirSync(join(app, 'src', 'routes'), { recursive: true })
					.filter((f) => String(f).endsWith('+page.svelte'))
					.map((f) => readFileSync(join(app, 'src', 'routes', String(f)), 'utf8'))
			];
			for (const n of all(plan(seed).flatMap((p) => p.roots)).filter((n) => n.thirdParty)) {
				// (right after the island, a script that edits it once the document is parsed)
				const after = new RegExp(
					`<N${n.id} [^\\n]*/>\\n\\s*\\{@html '<scr' \\+ 'ipt>[^\\n]*DOMContentLoaded`
				);
				expect(files.some((f) => after.test(f))).toBe(true);
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	// (repair mutant 388: a drift that keeps the element count and changes a tag reaches the repair's
	// tag check, which a prepended element never does)
	it("draws a third party that swaps an element's tag instead, from its own stream, the islands it touches unchanged", () => {
		const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
		const touched = seeds.flatMap((s) =>
			all(plan(s).flatMap((p) => p.roots)).filter((n) => n.thirdParty)
		);
		const kinds = new Set(touched.map((n) => n.thirdParty));
		expect([...kinds].sort()).toEqual(['prepend', 'retag', 'text']);
		const seed = seeds.find((s) =>
			all(plan(s).flatMap((p) => p.roots)).some((n) => n.thirdParty === 'retag')
		)!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			const pages = readdirSync(join(app, 'src', 'routes'), { recursive: true })
				.filter((f) => String(f).endsWith('.svelte'))
				.map((f) => readFileSync(join(app, 'src', 'routes', String(f)), 'utf8'))
				.concat(
					readdirSync(join(app, 'src', 'lib', 'gen'))
						.filter((f) => f.endsWith('.svelte'))
						.map((f) => readFileSync(join(app, 'src', 'lib', 'gen', f), 'utf8'))
				);
			for (const n of all(plan(seed).flatMap((p) => p.roots)).filter(
				(n) => n.thirdParty === 'retag'
			)) {
				const after = new RegExp(
					`<N${n.id} [^\\n]*/>\\n\\s*\\{@html '<scr' \\+ 'ipt>[^\\n]*replaceWith`
				);
				expect(pages.some((f) => after.test(f))).toBe(true);
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	// (repair mutant 419: a level that lined up said to have failed names a false ownership conflict,
	// heard only where every element lines up and one of them owns some of its children)
	it('draws a third party that adds only text, from its own stream, on islands that hold a <details>, the others unchanged', () => {
		const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
		const seed = seeds.find((s) =>
			all(plan(s).flatMap((p) => p.roots)).some((n) => n.thirdParty === 'text')
		)!;
		expect(seed).toBeDefined();
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			const pages = readdirSync(join(app, 'src', 'routes'), { recursive: true })
				.filter((f) => String(f).endsWith('.svelte'))
				.map((f) => readFileSync(join(app, 'src', 'routes', String(f)), 'utf8'))
				.concat(
					readdirSync(join(app, 'src', 'lib', 'gen'))
						.filter((f) => f.endsWith('.svelte'))
						.map((f) => readFileSync(join(app, 'src', 'lib', 'gen', f), 'utf8'))
				);
			for (const n of all(plan(seed).flatMap((p) => p.roots)).filter(
				(n) => n.thirdParty === 'text'
			)) {
				const after = new RegExp(
					`<N${n.id} [^\\n]*/>\\n\\s*\\{@html '<scr' \\+ 'ipt>[^\\n]*createTextNode`
				);
				expect(pages.some((f) => after.test(f))).toBe(true);
				const own = readFileSync(join(app, 'src', 'lib', 'gen', `N${n.id}.svelte`), 'utf8');
				expect(own).toContain('<details><summary>{label}</summary></details>');
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	// (head mutants: the head markers left in place, or the page's head copy never retired, need an
	// island with a <svelte:head> of its own, and a third party in its head block)
	it('draws islands with a <svelte:head> of their own, from their own stream, and a third party in some of those head blocks', () => {
		const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
		const heads = seeds.flatMap((s) => all(plan(s).flatMap((p) => p.roots)).filter((n) => n.head));
		expect(new Set(heads.map((n) => n.head))).toEqual(new Set(['own', 'drift']));
		for (const n of heads) {
			expect(n.kind).toBe('island');
			expect(['load', 'idle']).toContain(n.wake);
		}
		const seed = seeds.find((s) =>
			all(plan(s).flatMap((p) => p.roots)).some((n) => n.head === 'drift')
		)!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			const pages = readdirSync(join(app, 'src', 'routes'), { recursive: true })
				.filter((f) => String(f).endsWith('.svelte'))
				.map((f) => readFileSync(join(app, 'src', 'routes', String(f)), 'utf8'))
				.concat(
					readdirSync(join(app, 'src', 'lib', 'gen'))
						.filter((f) => f.endsWith('.svelte'))
						.map((f) => readFileSync(join(app, 'src', 'lib', 'gen', f), 'utf8'))
				);
			for (const n of all(plan(seed).flatMap((p) => p.roots)).filter((n) => n.head)) {
				const own = readFileSync(join(app, 'src', 'lib', 'gen', `N${n.id}.svelte`), 'utf8');
				expect(own).toContain('<svelte:head>');
				expect(own).toContain(`<style data-gen-head="n${n.id}">`);
				const drift = pages.some((f) => f.includes(`style[data-gen-head=n${n.id}]`));
				expect(drift).toBe(n.head === 'drift');
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it('draws empty regions, from their own stream: leaves that render nothing, each used inside a marked element', () => {
		const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
		const nodes = seeds.flatMap((s) => all(plan(s).flatMap((p) => p.roots)));
		expect(nodes.some((n) => n.empty === true)).toBe(true);
		for (const n of nodes.filter((n) => n.empty)) {
			expect(['island', 'hole', 'lake']).toContain(n.kind);
			expect(n.children).toEqual([]);
		}
		const seed = seeds.find((s) => all(plan(s).flatMap((p) => p.roots)).some((n) => n.empty))!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			write(app, plan(seed), seed);
			const lib = join(app, 'src', 'lib', 'gen');
			const users = readdirSync(lib)
				.filter((f) => f.endsWith('.svelte'))
				.map((f) => readFileSync(join(lib, f), 'utf8'));
			const pages = readdirSync(join(app, 'src', 'routes'), { recursive: true })
				.filter((f) => String(f).endsWith('+page.svelte'))
				.map((f) => readFileSync(join(app, 'src', 'routes', String(f)), 'utf8'));
			for (const n of all(plan(seed).flatMap((p) => p.roots)).filter((n) => n.empty)) {
				const src = readFileSync(join(lib, `N${n.id}.svelte`), 'utf8');
				// (nothing after its script: no element, no text)
				expect(src.slice(src.indexOf('</script>') + '</script>'.length).trim()).toBe('');
				// (where it is used, a marked element holds it: the region oracle knows it is the app's)
				const tag = new RegExp(`<div data-gen-empty>\\s*<N${n.id} `);
				expect([...users, ...pages].some((s) => tag.test(s))).toBe(true);
			}
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	// real apps (apps/palaestra, examples/mfe, apps/docs) time a hole with `fetch`; `wake` on a hole
	// is deprecated (a build warning on every generated hole), and a hole ships no JS: the generated
	// hole's button and count, written as if it woke once it landed, never worked
	it('times a hole with fetch, never wake, and gives it no state or button of its own', () => {
		const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
		const seed = seeds.find((s) =>
			all(plan(s).flatMap((p) => p.roots)).some((n) => n.kind === 'hole' && n.wake && !n.maxAge)
		)!;
		const app = mkdtempSync(join(tmpdir(), 'sim-gen-'));
		try {
			const drawn = plan(seed);
			write(app, drawn, seed);
			const lib = join(app, 'src', 'lib', 'gen');
			const sources = readdirSync(lib)
				.filter((f) => f.endsWith('.svelte'))
				.map((f) => readFileSync(join(lib, f), 'utf8'));
			const routes = drawn.map((p) =>
				readFileSync(join(app, 'src', 'routes', p.path.slice(1), '+page.svelte'), 'utf8')
			);
			for (const src of [...sources, ...routes])
				expect(src).not.toMatch(/render: 'deferred', wake:/);
			expect([...sources, ...routes].some((s) => /render: 'deferred', fetch: '/.test(s))).toBe(
				true
			);
			for (const n of all(drawn.flatMap((p) => p.roots)).filter((n) => n.kind === 'hole'))
				expect(readFileSync(join(lib, `N${n.id}.svelte`), 'utf8')).not.toContain('$state(');
			// (and a kept render's preset: the app's config is checked in)
			const config = readFileSync(
				new URL('../../../apps/sim-gen/vite.config.ts', import.meta.url),
				'utf8'
			);
			expect(config).not.toContain('{ wake }');
			expect(config).toContain('{ fetch }');
		} finally {
			rmSync(app, { recursive: true, force: true });
		}
	});

	it("draws some apps' island wakes as real apps have them, from their own stream: mostly load, then visible, a media query on some", () => {
		const islands = (s: number) =>
			all(plan(s).flatMap((p) => p.roots)).filter((n) => n.kind === 'island');
		const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
		const shaped = seeds.filter((s) => shape_plan(s) === 'real');
		expect(shaped.length).toBeGreaterThan(50);
		expect(shaped.length).toBeLessThan(150);
		const wakes = shaped.flatMap((s) => islands(s).map((n) => n.wake!));
		const share = (w: string) => wakes.filter((x) => x === w).length / wakes.length;
		expect(share('load')).toBeGreaterThan(0.55);
		expect(share('visible')).toBeGreaterThan(0.12);
		expect(wakes.some((w) => w.startsWith('('))).toBe(true);
		// (an app drawn the other way keeps its trees as they were: the shape is drawn apart)
		const drawn = seeds.filter((s) => shape_plan(s) === 'drawn');
		const all_wakes = drawn.flatMap((s) => islands(s).map((n) => n.wake!));
		expect(all_wakes.some((w) => w.startsWith('('))).toBe(false);
	});
});
