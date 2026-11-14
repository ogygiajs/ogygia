// PAGE-CSR invariant (internal/notes/INVARIANTS.md): a page's effective csr is Kit's own
// computation — the option-file chain root → page dir, deepest declaration wins — and a LAYOUT
// has no world of its own: it derives from the pages it serves (all true → strip, all false →
// island world, mixed → shared world). The regression this guards: `csr = false` declared only
// in a deep catch-all made the ROOT layout read as csr=true, stripping its Header/BootEffects
// islands while Kit shipped no client for those pages — dead chrome (hit at a consumer).
//
// This suite is deliberately a MATRIX — csr-topology bugs keep recurring, so every declaration
// position, chain shape, and layout fold is pinned here, plus the transform-level strip/keep
// seam. The browser truth lives in e2e/deep-csr.ts (a real build of internal/repro-deep-csr).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	routeCsrIsFalse,
	routeCsrIsTrue,
	csrTrueRouteIds,
	errorCsrTrueRouteIds,
	rootLayoutCsrTrue,
	hasAnyCsrTrueRoute,
	read_csr,
	route_reader
} from '../src/kit.ts';
import { node_fs } from '../src/fs.ts';
import { transformHost } from '../src/region/transform.ts';
import { dedent } from '@ogygia/core/contract';

/** The disk, read through a reader of its own per test (a fresh set of answers). */
let R = route_reader(node_fs);

/** Write a route tree: { 'content/[...slug]/+page.ts': 'export const csr = false;' }. */
function tree(files: Record<string, string>): string {
	const routes = path.join(mkdtempSync(path.join(tmpdir(), 'og-csr-')), 'routes');
	for (const [rel, src] of Object.entries(files)) {
		const abs = path.join(routes, rel);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, src);
	}
	return routes;
}
const at = (routes: string, rel: string) => path.join(routes, rel);
/** world(host) → 'strip' | 'island' | 'shared' — the tri-state the driver derives. */
function world(routes: string, rel: string): 'strip' | 'island' | 'shared' {
	const host = at(routes, rel);
	return routeCsrIsTrue(R, host, routes)
		? 'strip'
		: routeCsrIsFalse(R, host, routes)
			? 'island'
			: 'shared';
}

beforeEach(() => {
	R = route_reader({ ...node_fs });
});

// ── read_csr — the single declaration reader ─────────────────────────────────────────────────

describe('read_csr — declaration forms', () => {
	const one = (src: string) => {
		const routes = tree({ '+page.ts': src });
		return read_csr(R, at(routes, '+page.ts'));
	};
	it('plain false / true / absent', () => {
		expect(one('export const csr = false;\n')).toBe(false);
		expect(one('export const csr = true;\n')).toBe(true);
		expect(one('export const prerender = true;\n')).toBe(undefined);
	});
	it('typed form `csr: boolean`', () => {
		expect(one('export const csr: boolean = false;\n')).toBe(false);
	});
	it('commented-out declarations never win', () => {
		expect(
			one(
				`${dedent`
			// export const csr = true
			export const csr = false;
		`}\n`
			)
		).toBe(false);
		expect(
			one(
				`${dedent`
			/* export const csr = true */
			export const csr = false;
		`}\n`
			)
		).toBe(false);
		expect(one('// export const csr = false\n')).toBe(undefined);
	});
});

// ── per-PAGE effective csr — Kit's own-chain rule ────────────────────────────────────────────

describe('page world — option-file chain, deepest wins', () => {
	it.each([
		['+layout.ts', 'layout .ts'],
		['+layout.js', 'layout .js'],
		['+layout.server.ts', 'layout .server.ts'],
		['+page.ts', 'page .ts'],
		['+page.server.ts', 'page .server.ts'],
		['+page.js', 'page .js']
	])('csr=false in root-level %s reaches the page', (file) => {
		const routes = tree({
			[file]: 'export const csr = false;\n',
			'+page.svelte': '<h1>p</h1>'
		});
		expect(routeCsrIsFalse(R, at(routes, '+page.svelte'), routes)).toBe(true);
	});

	it('deepest declaration wins across a false → true → false chain', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'a/+layout.ts': 'export const csr = true;\n',
			'a/b/+layout.ts': 'export const csr = false;\n',
			'a/b/+page.svelte': '<h1>b</h1>',
			'a/+page.svelte': '<h1>a</h1>',
			'+page.svelte': '<h1>root</h1>'
		});
		expect(routeCsrIsFalse(R, at(routes, 'a/b/+page.svelte'), routes)).toBe(true);
		expect(routeCsrIsFalse(R, at(routes, 'a/+page.svelte'), routes)).toBe(false);
		expect(routeCsrIsFalse(R, at(routes, '+page.svelte'), routes)).toBe(true);
	});

	it("the page's own option file beats every layout above it", () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'admin/+page.ts': 'export const csr = true;\n',
			'admin/+page.svelte': '<h1>admin</h1>'
		});
		expect(routeCsrIsTrue(R, at(routes, 'admin/+page.svelte'), routes)).toBe(true);
	});

	it.each([
		['+layout.server.ts', '+layout.ts'],
		['+page.server.ts', '+page.ts']
	])(
		'a universal csr = true beats a server csr = false on one node, like Kit (%s, %s)',
		(server, universal) => {
			const routes = tree({
				[server]: 'export const csr = false;\n',
				[universal]: 'export const csr = true;\n',
				'+page.svelte': '<h1>home</h1>'
			});
			expect(routeCsrIsFalse(R, at(routes, '+page.svelte'), routes)).toBe(false);
			expect(routeCsrIsTrue(R, at(routes, '+page.svelte'), routes)).toBe(true);
			expect(csrTrueRouteIds(R, routes)).toEqual(['/']);
		}
	);

	it('a universal csr = false beats a server csr = true on one node, like Kit', () => {
		const routes = tree({
			'+layout.server.ts': 'export const csr = true;\n',
			'+layout.ts': 'export const csr = false;\n',
			'+page.svelte': '<h1>home</h1>'
		});
		expect(routeCsrIsFalse(R, at(routes, '+page.svelte'), routes)).toBe(true);
		expect(rootLayoutCsrTrue(R, routes)).toBe(false);
	});

	it('group-segment option files participate in the chain', () => {
		const routes = tree({
			'(app)/+layout.ts': 'export const csr = false;\n',
			'(app)/dash/+page.svelte': '<h1>d</h1>'
		});
		expect(routeCsrIsFalse(R, at(routes, '(app)/dash/+page.svelte'), routes)).toBe(true);
	});

	it('rest/optional param dirs are ordinary chain segments', () => {
		const routes = tree({
			'docs/[[lang]]/[...slug]/+page.ts': 'export const csr = false;\n',
			'docs/[[lang]]/[...slug]/+page.svelte': '<h1>doc</h1>'
		});
		expect(routeCsrIsFalse(R, at(routes, 'docs/[[lang]]/[...slug]/+page.svelte'), routes)).toBe(
			true
		);
	});

	it('non-route files and files outside routesDir are never route hosts', () => {
		const routes = tree({ '+page.svelte': '<h1>p</h1>' });
		expect(routeCsrIsFalse(R, at(routes, 'Widget.svelte'), routes)).toBe(false);
		expect(routeCsrIsTrue(R, at(routes, 'Widget.svelte'), routes)).toBe(false);
		expect(routeCsrIsFalse(R, '/elsewhere/+page.svelte', routes)).toBe(false);
	});
});

// ── LAYOUT world — the fold over the pages it serves ─────────────────────────────────────────

describe('layout world — derived from pages, never its own chain', () => {
	it('THE REGRESSION: csr=false only in a deep catch-all still islands the root layout', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'content/[...slug]/+page.ts': 'export const csr = false;\n',
			'content/[...slug]/+page.svelte': '<h1>c</h1>'
		});
		expect(world(routes, '+layout.svelte')).toBe('island');
		expect(csrTrueRouteIds(R, routes)).toEqual([]);
		expect(hasAnyCsrTrueRoute(R, routes)).toBe(false);
	});

	it('mixed subtree → shared world; runtime set carries exactly the true pages', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'content/[...slug]/+page.ts': 'export const csr = false;\n',
			'content/[...slug]/+page.svelte': '<h1>c</h1>',
			'spa/+page.svelte': '<h1>spa</h1>' // no options → Kit default true
		});
		expect(world(routes, '+layout.svelte')).toBe('shared');
		expect(csrTrueRouteIds(R, routes)).toEqual(['/spa']);
		expect(hasAnyCsrTrueRoute(R, routes)).toBe(true);
	});

	it('root csr=false with a deeper csr=true override — layout goes shared', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+layout.svelte': '<slot />',
			'+page.svelte': '<h1>home</h1>',
			'admin/+page.ts': 'export const csr = true;\n',
			'admin/+page.svelte': '<h1>admin</h1>'
		});
		expect(world(routes, '+layout.svelte')).toBe('shared');
		expect(csrTrueRouteIds(R, routes)).toEqual(['/admin']);
	});

	it('all pages Kit-hydrated → the layout strips', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'+page.svelte': '<h1>home</h1>',
			'about/+page.svelte': '<h1>about</h1>'
		});
		expect(world(routes, '+layout.svelte')).toBe('strip');
	});

	it('every page below csr=false (declared at various depths) → island world', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'+layout.ts': 'export const csr = false;\n',
			'+page.svelte': '<h1>home</h1>',
			'blog/[slug]/+page.svelte': '<h1>post</h1>'
		});
		expect(world(routes, '+layout.svelte')).toBe('island');
	});

	it('NESTED layouts are each judged by their OWN subtree', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'spa/+page.svelte': '<h1>spa</h1>',
			'content/+layout.svelte': '<slot />',
			'content/+layout.ts': 'export const csr = false;\n',
			'content/a/+page.svelte': '<h1>a</h1>',
			'content/b/+page.svelte': '<h1>b</h1>'
		});
		expect(world(routes, '+layout.svelte')).toBe('shared'); // serves spa (true) + content (false)
		expect(world(routes, 'content/+layout.svelte')).toBe('island'); // its own subtree is pure false
	});

	it('a nested layout whose subtree is pure csr=true strips even under a csr=false root', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+layout.svelte': '<slot />',
			'+page.svelte': '<h1>home</h1>',
			'admin/+layout.svelte': '<slot />',
			'admin/+layout.ts': 'export const csr = true;\n',
			'admin/+page.svelte': '<h1>admin</h1>'
		});
		expect(world(routes, 'admin/+layout.svelte')).toBe('strip');
		expect(world(routes, '+layout.svelte')).toBe('shared');
	});

	it('a layout with no pages below falls back to its own chain', () => {
		const routes = tree({
			'+page.svelte': '<h1>home</h1>',
			'api/+layout.svelte': '<slot />',
			'api/+server.ts': 'export const GET = () => new Response("ok");\n'
		});
		expect(world(routes, 'api/+layout.svelte')).toBe('strip'); // own chain: Kit default true
		const routes2 = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+page.svelte': '<h1>home</h1>',
			'api/+layout.svelte': '<slot />'
		});
		expect(world(routes2, 'api/+layout.svelte')).toBe('island'); // own chain: root false
	});

	it('a csr=false layout whose every page turns csr back on strips: the pages decide, not its chain', () => {
		const routes = tree({
			'shop/+layout.ts': 'export const csr = false;\n',
			'shop/+layout.svelte': '<slot />',
			'shop/+page.ts': 'export const csr = true;\n',
			'shop/+page.svelte': '<h1>shop</h1>'
		});
		expect(world(routes, 'shop/+layout.svelte')).toBe('strip');
	});

	it('a redirect-only route (no page component) renders nothing, so it counts in no world', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+layout.svelte': '<slot />',
			'+page.svelte': '<h1>home</h1>',
			'old/+page.server.ts': 'export const load = () => { throw new Error("moved"); };\n',
			'old/+page.ts': 'export const csr = true;\n'
		});
		expect(world(routes, '+layout.svelte')).toBe('island');
		expect(csrTrueRouteIds(R, routes)).toEqual([]);
	});

	it('sibling-prefix dirs do not leak into a layout fold (docs vs docs-old)', () => {
		const routes = tree({
			'docs/+layout.svelte': '<slot />',
			'docs/+page.svelte': '<h1>docs</h1>',
			'docs-old/+page.ts': 'export const csr = false;\n',
			'docs-old/+page.svelte': '<h1>old</h1>'
		});
		// docs-old is NOT below docs/ — the docs layout must not see its csr=false.
		expect(world(routes, 'docs/+layout.svelte')).toBe('strip');
	});
});

// ── runtime set + cache ──────────────────────────────────────────────────────────────────────

describe('csrTrueRouteIds + cache', () => {
	it('root page maps to "/", groups stripped, multiple entries', () => {
		const routes = tree({
			'+page.svelte': '<h1>home</h1>',
			'(app)/dash/+page.svelte': '<h1>d</h1>',
			'blog/+page.ts': 'export const csr = false;\n',
			'blog/+page.svelte': '<h1>b</h1>'
		});
		expect(csrTrueRouteIds(R, routes).sort()).toEqual(['/', '/dash']);
	});

	it('a file event picks up new declarations AND new pages', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'spa/+page.svelte': '<h1>spa</h1>'
		});
		expect(world(routes, '+layout.svelte')).toBe('strip');
		// a csr=false declaration appears
		writeFileSync(at(routes, 'spa/+page.ts'), 'export const csr = false;\n');
		expect(R.touch(at(routes, 'spa/+page.ts'), 'create')).toBe(true);
		expect(world(routes, '+layout.svelte')).toBe('island');
		// a brand-new csr=true page appears, in a new directory
		mkdirSync(at(routes, 'landing'), { recursive: true });
		writeFileSync(at(routes, 'landing/+page.svelte'), '<h1>l</h1>');
		expect(R.touch(at(routes, 'landing/+page.svelte'), 'create')).toBe(true);
		expect(world(routes, '+layout.svelte')).toBe('shared');
		expect(csrTrueRouteIds(R, routes)).toEqual(['/landing']);
	});
});

// ── error renders — Kit's `+error.svelte` is rendered from the LAYOUT branch alone ───────────
// Kit's server renderer builds an error page's options from `PageNodes(layouts)`: the page node,
// and with it the page's `csr = false`, is dropped. So a 404 under a client-off page is hydrated
// whenever the layouts say so — the map ogygia keys the document on must have an error twin, or the
// chrome lakes render bare into a document Kit then hydrates (mismatch → the header vanished on
// every error page of a customer deploy).
describe('errorCsrTrueRouteIds / rootLayoutCsrTrue — the layout branch decides', () => {
	it('THE BUG: csr=false pages under a default (csr=true) layout — pages off, their error pages ON', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'+error.svelte': '<h1>err</h1>',
			'+page.ts': 'export const csr = false;\n',
			'+page.svelte': '<h1>home</h1>',
			'products/+page.ts': 'export const csr = false;\n',
			'products/+page.svelte': '<h1>p</h1>'
		});
		expect(csrTrueRouteIds(R, routes)).toEqual([]); // the pages themselves: client-off
		expect(errorCsrTrueRouteIds(R, routes).sort()).toEqual(['/', '/products']); // their 404s: Kit's
		expect(rootLayoutCsrTrue(R, routes)).toBe(true); // no route matched → root layout default
	});

	it('csr=false declared on the layout chain turns the error pages off too', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+layout.svelte': '<slot />',
			'+page.svelte': '<h1>home</h1>',
			'admin/+page.ts': 'export const csr = true;\n',
			'admin/+page.svelte': '<h1>admin</h1>'
		});
		expect(csrTrueRouteIds(R, routes)).toEqual(['/admin']); // the page's own override holds for the page
		expect(errorCsrTrueRouteIds(R, routes)).toEqual([]); // but its error page is the layouts' (false)
		expect(rootLayoutCsrTrue(R, routes)).toBe(false);
	});

	it('deepest LAYOUT declaration wins, page files ignored, groups stripped', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+layout.svelte': '<slot />',
			'(app)/shop/+layout.ts': 'export const csr = true;\n',
			'(app)/shop/+layout.svelte': '<slot />',
			'(app)/shop/+page.ts': 'export const csr = false;\n',
			'(app)/shop/+page.svelte': '<h1>shop</h1>',
			'(app)/shop/cart/+page.svelte': '<h1>cart</h1>',
			'docs/+page.svelte': '<h1>docs</h1>'
		});
		expect(errorCsrTrueRouteIds(R, routes).sort()).toEqual(['/shop', '/shop/cart']);
		expect(csrTrueRouteIds(R, routes).sort()).toEqual(['/shop/cart']);
	});

	it('a new layout declaration is picked up after its file event', () => {
		const routes = tree({
			'+layout.svelte': '<slot />',
			'spa/+page.ts': 'export const csr = false;\n',
			'spa/+page.svelte': '<h1>spa</h1>'
		});
		expect(errorCsrTrueRouteIds(R, routes)).toEqual(['/spa']);
		writeFileSync(at(routes, '+layout.ts'), 'export const csr = false;\n');
		expect(R.touch(at(routes, '+layout.ts'), 'create')).toBe(true);
		expect(errorCsrTrueRouteIds(R, routes)).toEqual([]);
		expect(rootLayoutCsrTrue(R, routes)).toBe(false);
	});
});

// ── markdown route components — `+page.md` is a page like `+page.svelte` ──────────────────────

describe('route components in any extension', () => {
	it('a markdown page has its own world and counts for its layout', () => {
		const routes = tree({
			'+layout.ts': 'export const csr = false;\n',
			'+layout.svelte': '',
			'posts/a/+page.md': '# a\n',
			'posts/b/+page.svx': '# b\n',
			'posts/b/+page.ts': 'export const csr = true;\n'
		});
		expect(world(routes, 'posts/a/+page.md')).toBe('island');
		expect(world(routes, 'posts/b/+page.svx')).toBe('strip');
		expect(world(routes, '+layout.svelte')).toBe('shared');
		expect(csrTrueRouteIds(R, routes)).toEqual(['/posts/b']);
		expect(hasAnyCsrTrueRoute(R, routes)).toBe(true);
	});
	it('option scripts are not components', () => {
		const routes = tree({ '+layout.ts': 'export const csr = false;\n', '+page.ts': '' });
		expect(routeCsrIsFalse(R, at(routes, '+page.ts'), routes)).toBe(false);
		expect(routeCsrIsFalse(R, at(routes, '+page.server.ts'), routes)).toBe(false);
	});
});

// ── transform seam — what each world does to a layout's chrome islands ───────────────────────

const LAYOUT_HOST = `<script>
	import Header from '$lib/Header.svelte' with { wake: 'load' };
	let { children } = $props();
</script>

<Header />
<main>{@render children?.()}</main>
`;

function compile_layout(routeCsr: boolean | undefined) {
	return transformHost(LAYOUT_HOST, '/app/src/routes/+layout.svelte', {
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		ssr: true,
		virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_h: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
		devUrlFor: (p: string) => p,
		visibleMargin: '200px',
		presets: {},
		importKeys: {},
		idSalt: '',
		clientBindingStub: 'ogygia:region/client-binding-stub',
		routeCsr
	} as never) as { islands?: unknown[]; code?: string } | null;
}

describe('transform seam — route_csr tri-state on a layout host', () => {
	it('island world (false) and shared world (undefined) keep the chrome islands', () => {
		for (const rc of [false, undefined]) {
			const r = compile_layout(rc);
			expect(r?.islands?.length, `routeCsr=${String(rc)}`).toBeGreaterThan(0);
		}
	});
	it('strip world (true) hands the component to Kit as plain', () => {
		const r = compile_layout(true);
		// stripped output has no island registrations — Kit compiles + hydrates it inline
		expect(r?.islands?.length ?? 0).toBe(0);
		expect(r?.code ?? '').not.toContain('ogygia:region/wrapper');
	});
});
