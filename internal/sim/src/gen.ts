/**
 * THE RANDOM APP: `pnpm sim:gen --seed N` writes apps/sim-gen's pages and regions from a seed, so
 * the simulator runs apps nobody wrote by hand: islands on every schedule, holes (deferred
 * regions, some woken after they land, some slow on the server), lakes, nested in each other a few
 * levels deep, on pages a router moves between. Then `pnpm sim:builds --app apps/sim-gen` builds
 * it (twice, for deploys) and `pnpm sim --app apps/sim-gen` runs it.
 *
 *   node src/gen.ts --seed 7 [--app <dir>]
 *
 * Each region is a component of its own (`src/lib/gen/N<k>.svelte`) that imports its children
 * with their import attributes, as an app's components do. What a seed wrote is in
 * `src/lib/gen/plan.json` (the tree, for a finding's issue).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from './rng.ts';

type Wake = 'load' | 'idle' | 'visible' | 'interaction';

/** One region (or plain markup) of a generated page. */
export interface GenNode {
	readonly id: number;
	/** island: a woken region; hole: a deferred one (`wake`: woken once it lands); lake: frozen
	 *  server HTML (`wake: 'none'`); plain: a component with no region of its own; held: a region
	 *  a remote query returns (`region(N, props)`), rendered by a host with `<Region of>` (`wake`:
	 *  its baked schedule, none for `region: 'raw'`); live: one a `query.live` yields anew on each
	 *  tick, rendered by an island host. */
	readonly kind: 'island' | 'hole' | 'lake' | 'plain' | 'held' | 'live';
	readonly wake?: Wake;
	/** A hole whose server render waits this many ms. */
	readonly slow?: number;
	/** A hole the page gives a fallback. */
	readonly fallback?: boolean;
	/** A held region's host: plain server markup awaiting the query in the page's render
	 *  (`'page'`), or an island reading the query's `.current` (`'island'`). */
	readonly host?: 'page' | 'island';
	/** A held region's island host has a button: a command that changes the server's count and
	 *  answers with the region rendered again (single flight). */
	readonly command?: boolean;
	/** A held region on a page host shows a placeholder while it waits. */
	readonly placeholder?: boolean;
	/** A live region's ticks, this many ms apart. */
	readonly every?: number;
	readonly children: readonly GenNode[];
}

export interface GenPage {
	readonly path: string;
	readonly roots: readonly GenNode[];
}

const WAKES: readonly Wake[] = ['load', 'idle', 'visible', 'interaction'];

/** The plan a seed draws: pages, each a forest of regions up to 3 deep. */
export function plan(seed: number): GenPage[] {
	const r = rng(seed).fork('gen');
	// (held and live regions draw from a stream of their own: a seed's tree, drawn before they
	// existed, stays the same, with some of its regions held)
	const h = rng(seed).fork('gen held');
	let ids = 0;
	const held = (n: GenNode): GenNode => {
		if (n.kind === 'hole' || !h.chance(0.3)) return n;
		const wake = h.chance(0.5) ? h.pick(WAKES) : undefined;
		if (h.chance(0.3))
			return { id: n.id, kind: 'live', wake, every: h.pick([700, 3000]), children: n.children };
		const host = h.chance(0.5) ? 'island' : 'page';
		return {
			id: n.id,
			kind: 'held',
			wake,
			host,
			command: host === 'island' && h.chance(0.6),
			placeholder: host === 'page' && h.chance(0.5),
			children: n.children
		};
	};
	const node = (depth: number): GenNode => {
		const kind = r.weighted<GenNode['kind']>([
			['island', 4],
			['hole', 3],
			['lake', 1.5],
			['plain', 1.5]
		]);
		const n =
			depth >= 3
				? 0
				: r.weighted<number>([
						[0, 3],
						[1, 2],
						[2, 1]
					]);
		const children = Array.from({ length: n }, () => node(depth + 1));
		const id = ids++;
		if (kind === 'island') return held({ id, kind, wake: r.pick(WAKES), children });
		if (kind === 'hole')
			return {
				id,
				kind,
				wake: r.chance(0.4) ? r.pick(WAKES) : undefined,
				slow: r.chance(0.3) ? r.pick([5, 50, 400]) : undefined,
				fallback: r.chance(0.6),
				children
			};
		return held({ id, kind, children });
	};
	const pages = r.between(3, 6);
	return Array.from({ length: pages }, (_, i) => ({
		path: `/p${i}`,
		roots: Array.from({ length: r.between(1, 4) }, () => node(0))
	}));
}

/** How a parent imports `n`: its import attributes. */
function attributes(n: GenNode): string {
	switch (n.kind) {
		case 'island':
			return ` with { wake: '${n.wake}' }`;
		case 'lake':
			return ` with { wake: 'none' }`;
		case 'hole':
			return n.wake
				? ` with { render: 'deferred', wake: '${n.wake}' }`
				: ` with { render: 'deferred' }`;
		case 'plain':
			return '';
		// (the parent imports the region's host: a plain component, or an island)
		case 'held':
			return n.host === 'island' ? ` with { wake: 'load' }` : '';
		case 'live':
			return ` with { wake: 'load' }`;
	}
}

/** The component a parent imports for `n`: the region's own, or a held region's host. */
function name(n: GenNode): string {
	return n.kind === 'held' || n.kind === 'live' ? `H${n.id}` : `N${n.id}`;
}

/** Where `n` is used: its tag, with a fallback for a hole that has one. */
function usage(n: GenNode, indent: string): string {
	if (n.kind === 'hole' && n.fallback)
		return `${indent}<N${n.id} label="n${n.id}">\n${indent}\t{#snippet ogygiaFallback()}<p data-gen-fallback>loading n${n.id}…</p>{/snippet}\n${indent}</N${n.id}>`;
	return n.kind === 'held' || n.kind === 'live'
		? `${indent}<${name(n)} />`
		: `${indent}<N${n.id} label="n${n.id}" />`;
}

/** A held or live region's remote module: the query that returns it (and the command that changes
 *  it), importing its component with the schedule it bakes. */
function remote(n: GenNode): string {
	const mark = n.wake ? `{ wake: '${n.wake}' }` : `{ region: 'raw' }`;
	const lines = [
		`import { ${n.kind === 'live' ? 'query' : 'command, query'} } from '$app/server';`,
		`import { region } from 'ogygia';`,
		`import N${n.id} from './N${n.id}.svelte' with ${mark};`,
		''
	];
	if (n.kind === 'live')
		lines.push(
			`export const live${n.id} = query.live(async function* () {`,
			`\tfor (let n = 0; ; n++) {`,
			`\t\tyield await region(N${n.id}, { label: \`n${n.id} tick \${n}\` });`,
			`\t\tawait new Promise((r) => setTimeout(r, ${n.every}));`,
			`\t}`,
			`});`
		);
	else
		lines.push(
			`// (the server's count of this region's commands: what a command changes)`,
			`const counts = globalThis as unknown as { __sim_gen_held?: Record<number, number> };`,
			`const count = () => (counts.__sim_gen_held ??= {})[${n.id}] ?? 0;`,
			`const label = () => \`n${n.id} #\${count()}\`;`,
			'',
			`export const held${n.id} = query(async () => await region(N${n.id}, { label: label() }));`,
			'',
			`export const bump${n.id} = command(async () => {`,
			`\t(counts.__sim_gen_held ??= {})[${n.id}] = count() + 1;`,
			`\treturn await region(N${n.id}, { label: label() });`,
			`});`
		);
	return lines.join('\n') + '\n';
}

/** A held or live region's host. */
function host(n: GenNode): string {
	const call = n.kind === 'live' ? `live${n.id}` : `held${n.id}`;
	const imports = n.kind === 'held' && n.command ? `${call}, bump${n.id}` : call;
	const lines = [
		'<script lang="ts">',
		`\timport { Region } from 'ogygia';`,
		`\timport { ${imports} } from './h${n.id}.remote';`
	];
	if (n.kind === 'held' && n.host === 'page')
		return [
			...lines,
			'</script>',
			'',
			`<div data-gen="held-host">`,
			n.placeholder
				? `\t<Region of={${call}()}>\n\t\t{#snippet placeholder()}<p data-gen-placeholder>waiting for n${n.id}…</p>{/snippet}\n\t</Region>`
				: `\t<Region of={${call}()} />`,
			'</div>',
			''
		].join('\n');
	return [
		...lines,
		`\tconst value = ${call}();`,
		'</script>',
		'',
		`<div data-gen="${n.kind}-host">`,
		'\t{#if value.current}',
		'\t\t<Region of={value.current} />',
		'\t{:else}',
		`\t\t<span data-gen-pending>connecting n${n.id}…</span>`,
		'\t{/if}',
		...(n.kind === 'held' && n.command
			? [`\t<button onclick={() => bump${n.id}()}>bump n${n.id}</button>`]
			: []),
		'</div>',
		''
	].join('\n');
}

/** The component file of `n`. */
function component(n: GenNode): string {
	const interactive =
		n.kind === 'island' ||
		((n.kind === 'hole' || n.kind === 'held' || n.kind === 'live') && n.wake !== undefined);
	const lines = ['<script lang="ts">', "\timport type { Snippet } from 'svelte';"];
	for (const c of n.children)
		lines.push(`\timport ${name(c)} from './${name(c)}.svelte'${attributes(c)};`);
	lines.push(
		"\tlet { label = '' }: { label?: string; ogygiaFallback?: Snippet } = $props();",
		...(interactive ? ['\tlet count = $state(0);'] : []),
		...(n.slow ? [`\tawait new Promise((r) => setTimeout(r, ${n.slow}));`] : []),
		'</script>',
		'',
		`<div data-gen="${n.kind}" data-build={import.meta.env.VITE_SIM_BUILD}>`,
		'\t<span>{label}</span>',
		...(interactive
			? ['\t<button onclick={() => (count += 1)}>{label} pressed {count}</button>']
			: []),
		...n.children.map((c) => usage(c, '\t')),
		'</div>',
		''
	);
	return lines.join('\n');
}

/** Writes `pages` into `app`: its routes (a nav to every page on each) and its region components. */
export function write(app: string, pages: readonly GenPage[], seed: number): void {
	const routes = join(app, 'src', 'routes');
	const lib = join(app, 'src', 'lib', 'gen');
	rmSync(routes, { recursive: true, force: true });
	rmSync(lib, { recursive: true, force: true });
	mkdirSync(routes, { recursive: true });
	mkdirSync(lib, { recursive: true });
	const nav = ['/', ...pages.map((p) => p.path)].map((p) => `<a href="${p}">${p}</a>`).join(' ');
	writeFileSync(
		join(routes, '+layout.svelte'),
		`<script lang="ts">\n\tlet { children } = $props();\n</script>\n\n<nav>${nav}</nav>\n{@render children()}\n`
	);
	// (the app's pages are server HTML with islands: no Kit client on them)
	writeFileSync(
		join(routes, '+layout.ts'),
		'export const csr = false;\nexport const prerender = false;\n'
	);
	writeFileSync(join(routes, '+page.svelte'), `<h1>generated app, seed ${seed}</h1>\n`);
	const walk = (n: GenNode): void => {
		writeFileSync(join(lib, `N${n.id}.svelte`), component(n));
		if (n.kind === 'held' || n.kind === 'live') {
			writeFileSync(join(lib, `H${n.id}.svelte`), host(n));
			writeFileSync(join(lib, `h${n.id}.remote.ts`), remote(n));
		}
		n.children.forEach(walk);
	};
	for (const page of pages) {
		const dir = join(routes, page.path.slice(1));
		mkdirSync(dir, { recursive: true });
		const imports = page.roots.map(
			(n) => `\timport ${name(n)} from '$lib/gen/${name(n)}.svelte'${attributes(n)};`
		);
		writeFileSync(
			join(dir, '+page.svelte'),
			[
				'<script lang="ts">',
				...imports,
				'</script>',
				'',
				`<h1>${page.path}</h1>`,
				...page.roots.map((n) => usage(n, '')),
				''
			].join('\n')
		);
		page.roots.forEach(walk);
	}
	writeFileSync(join(lib, 'plan.json'), JSON.stringify({ seed, pages }, null, '\t') + '\n');
}

function main(): void {
	const arg = (flag: string) => {
		const at = process.argv.indexOf(flag);
		return at === -1 ? undefined : process.argv[at + 1];
	};
	const seed = Number(arg('--seed') ?? 1);
	const app = resolve(
		arg('--app') ?? fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url))
	);
	const pages = plan(seed);
	write(app, pages, seed);
	const count = (ns: readonly GenNode[]): number =>
		ns.reduce((s, n) => s + 1 + count(n.children), 0);
	console.log(
		`[sim] generated ${pages.length} pages, ${count(pages.flatMap((p) => p.roots))} regions (seed ${seed}) in ${app}`
	);
}

if (import.meta.main) main();
