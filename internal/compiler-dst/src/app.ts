/**
 * SMALL APPS, GENERATED. An app is its files: `{ absolute path: text }` under `ROOT`. The shape is
 * data (`AppShape`), drawn by fast-check, so a failing app shrinks to the fewest routes, components
 * and marks that still fail. Each knob is a thing the compiler decides on: a route tree (groups,
 * nesting), each node's `csr` (layout or page option file, universal or server, or unset), library
 * components that import each other, and the import marks that make a component a region.
 */
import fc from 'fast-check';

export const ROOT = '/dst-app';
export const ROUTES = `${ROOT}/src/routes`;
export const LIB = `${ROOT}/src/lib`;

/** A route directory, relative to `src/routes` (`''` is the root). */
export const ROUTE_DIRS = ['', 'a', 'a/b', '(g)', '(g)/c', 'd'] as const;
export type RouteDir = (typeof ROUTE_DIRS)[number];

/** An import's mark: none (plain), or the wake attribute that makes the import a region. */
export const MARKS = ['plain', 'load', 'idle', 'visible'] as const;
export type Mark = (typeof MARKS)[number];

/** A node's csr: unset, or set in its universal or its server option file. */
export type Csr = 'unset' | 'true' | 'false' | 'server-true' | 'server-false';
const CSRS: readonly Csr[] = ['unset', 'true', 'false', 'server-true', 'server-false'];

export interface Use {
	/** the library component imported (an index into `components`) */
	readonly component: number;
	readonly mark: Mark;
}

export interface Route {
	readonly dir: RouteDir;
	readonly page: boolean;
	readonly layout: boolean;
	readonly page_csr: Csr;
	readonly layout_csr: Csr;
	readonly uses: readonly Use[];
}

export interface Component {
	/** components this one imports: only later ones, so the graph has no cycle */
	readonly uses: readonly Use[];
	readonly state: boolean;
}

export interface AppShape {
	readonly routes: readonly Route[];
	readonly components: readonly Component[];
}

const MAX_COMPONENTS = 4;

const use = (n: number) =>
	fc.record({ component: fc.nat({ max: n - 1 }), mark: fc.constantFrom(...MARKS) });

export const app_shape: fc.Arbitrary<AppShape> = fc
	.integer({ min: 1, max: MAX_COMPONENTS })
	.chain((n) =>
		fc.record({
			components: fc.array(
				fc.record({ uses: fc.array(use(n), { maxLength: 2 }), state: fc.boolean() }),
				{ minLength: n, maxLength: n }
			),
			routes: fc.uniqueArray(
				fc.record({
					dir: fc.constantFrom(...ROUTE_DIRS),
					page: fc.boolean(),
					layout: fc.boolean(),
					page_csr: fc.constantFrom(...CSRS),
					layout_csr: fc.constantFrom(...CSRS),
					uses: fc.array(use(n), { maxLength: 3 })
				}),
				{ minLength: 1, maxLength: ROUTE_DIRS.length, selector: (r) => r.dir }
			)
		})
	);

const component_name = (i: number) => `C${i}`;

function imports(uses: readonly Use[], from: 'route' | 'lib'): string {
	const seen = new Set<number>();
	const lines: string[] = [];
	for (const u of uses) {
		if (seen.has(u.component)) continue; // one import per component per file
		seen.add(u.component);
		const spec =
			from === 'lib'
				? `./${component_name(u.component)}.svelte`
				: `$lib/${component_name(u.component)}.svelte`;
		const attr = u.mark === 'plain' ? '' : ` with { wake: '${u.mark}' }`;
		lines.push(`import ${component_name(u.component)} from '${spec}'${attr};`);
	}
	return lines.join('\n');
}

function markup(uses: readonly Use[]): string {
	const seen = new Set<number>();
	const out: string[] = [];
	for (const u of uses) {
		if (seen.has(u.component)) continue;
		seen.add(u.component);
		out.push(`<${component_name(u.component)} />`);
	}
	return out.join('\n');
}

function svelte(script: string, body: string): string {
	return script ? `<script>\n${script}\n</script>\n${body}\n` : `${body}\n`;
}

function option_file(dir: string, kind: 'page' | 'layout', csr: Csr): [string, string] | null {
	if (csr === 'unset') return null;
	const server = csr.startsWith('server-');
	const value = server ? csr.slice('server-'.length) : csr;
	return [`${dir}/+${kind}${server ? '.server' : ''}.ts`, `export const csr = ${value};\n`];
}

/** The app's files. A component only imports later ones, so the closure is finite. */
export function app_files(shape: AppShape): Record<string, string> {
	const files: Record<string, string> = {};
	const n = shape.components.length;
	shape.components.forEach((c, i) => {
		const uses = c.uses.filter((u) => u.component > i && u.component < n);
		const state = c.state ? `let n = $state(0);` : '';
		const script = [imports(uses, 'lib'), state].filter(Boolean).join('\n');
		const own = c.state
			? `<button onclick={() => n++}>{n}</button>`
			: `<p>${component_name(i)}</p>`;
		files[`${LIB}/${component_name(i)}.svelte`] = svelte(script, [own, markup(uses)].join('\n'));
	});
	for (const r of shape.routes) {
		const dir = r.dir ? `${ROUTES}/${r.dir}` : ROUTES;
		const uses = r.uses.filter((u) => u.component < n);
		if (r.page)
			files[`${dir}/+page.svelte`] = svelte(
				imports(uses, 'route'),
				markup(uses) || '<h1>page</h1>'
			);
		if (r.layout)
			files[`${dir}/+layout.svelte`] = svelte(imports(uses, 'route'), `${markup(uses)}\n<slot />`);
		for (const o of [
			option_file(dir, 'page', r.page_csr),
			option_file(dir, 'layout', r.layout_csr)
		])
			if (o) files[o[0]] = o[1];
	}
	return files;
}
