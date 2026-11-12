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
import { rng, type Rng } from './rng.ts';

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

/** A region tree drawn from `r`, depth first (a child's id before its parent's, ids from `first`);
 *  `wrap` may turn a drawn region into another kind (held, live). */
function trees(
	r: Rng,
	wrap: (n: GenNode) => GenNode = (n) => n,
	first = 0
): (depth: number) => GenNode {
	let ids = first;
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
		if (kind === 'island') return wrap({ id, kind, wake: r.pick(WAKES), children });
		if (kind === 'hole')
			return {
				id,
				kind,
				wake: r.chance(0.4) ? r.pick(WAKES) : undefined,
				slow: r.chance(0.3) ? r.pick([5, 50, 400]) : undefined,
				fallback: r.chance(0.6),
				children
			};
		return wrap({ id, kind, children });
	};
	return node;
}

/** The plan a seed draws: pages, each a forest of regions up to 3 deep. */
export function plan(seed: number): GenPage[] {
	const r = rng(seed).fork('gen');
	// (held and live regions draw from a stream of their own: a seed's tree, drawn before they
	// existed, stays the same, with some of its regions held)
	const h = rng(seed).fork('gen held');
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
	const node = trees(r, held);
	const pages = r.between(3, 6);
	return Array.from({ length: pages }, (_, i) => ({
		path: `/p${i}`,
		roots: Array.from({ length: r.between(1, 4) }, () => node(0))
	}));
}

/** A widget the peer app serves (`federate({ widgets })`): a root holding a region tree. */
export interface GenWidget {
	readonly name: string;
	readonly children: readonly GenNode[];
}

/** One place a page of the app renders a peer's widget, from its load. */
export interface GenSlot {
	readonly id: number;
	/** The app's page (`/p<i>`). */
	readonly page: string;
	readonly widget: string;
	/** Baked into the page in one signed hop, or a hole the page's browser fetches through the
	 *  app's own endpoint. */
	readonly render: 'static' | 'deferred';
	/** The page shows a placeholder while a deferred one comes. */
	readonly placeholder: boolean;
}

/** The peer app of a federated seed (apps/sim-gen-peer): widgets the app's pages render, and pages
 *  the app mounts under `/peer` (through its server router's `mount(peer)`, or a Kit catchall's
 *  `mount.kit(peer)`). */
export interface GenPeer {
	readonly mount: 'router' | 'kit';
	readonly widgets: readonly GenWidget[];
	/** The peer's own pages (`/q<i>`), at `/peer/q<i>` in the app. */
	readonly pages: readonly GenPage[];
	readonly slots: readonly GenSlot[];
}

/** The peer a seed draws for its app of `pages`, or null (most seeds: one app alone). Its own
 *  stream (`gen peer`): the app's tree is what it was before peers existed. */
export function peer_plan(seed: number, pages: readonly GenPage[]): GenPeer | null {
	const r = rng(seed).fork('gen peer');
	if (!r.chance(0.5)) return null;
	// (the peer's regions are numbered from 1000: its `n1003` is never the app's `n3`)
	const node = trees(r, undefined, 1000);
	const widgets = Array.from({ length: r.between(1, 3) }, (_, i) => ({
		name: `w${i}`,
		children: Array.from({ length: r.between(1, 3) }, () => node(1))
	}));
	const own = Array.from({ length: r.between(1, 3) }, (_, i) => ({
		path: `/q${i}`,
		roots: Array.from({ length: r.between(1, 3) }, () => node(0))
	}));
	let ids = 0;
	const slots: GenSlot[] = [];
	for (const page of pages)
		for (
			let k = r.weighted<number>([
				[0, 2],
				[1, 3],
				[2, 1]
			]);
			k > 0;
			k--
		) {
			const render = r.chance(0.5) ? 'static' : 'deferred';
			slots.push({
				id: ids++,
				page: page.path,
				widget: r.pick(widgets).name,
				render,
				placeholder: render === 'deferred' && r.chance(0.5)
			});
		}
	return { mount: r.chance(0.7) ? 'router' : 'kit', widgets, pages: own, slots };
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
		'\t{:else if value.error}',
		`\t\t<span data-gen-error>n${n.id} failed</span>`,
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

/** Where a federated app mounts its peer's pages. */
export const MOUNT = '/peer';

/** A slot's tag on its page: the widget's region, with a placeholder for a deferred one that has
 *  one. */
function slot_usage(s: GenSlot): string {
	return s.placeholder
		? `<div data-gen="slot">\n\t<Region of={data.r${s.id}}>\n\t\t{#snippet placeholder()}<p data-gen-placeholder>waiting for r${s.id}…</p>{/snippet}\n\t</Region>\n</div>`
		: `<div data-gen="slot"><Region of={data.r${s.id}} /></div>`;
}

/** The app's federation (`src/lib/gen/federation.server.ts`): one identity, the peer it calls. */
function app_federation(): string {
	return [
		`import { federate } from '@ogygia/federation';`,
		`import { env } from '$env/dynamic/private';`,
		'',
		`// (the simulator gives each app its keys and every app's origin: internal/sim/src/cli.ts)`,
		`export const { peer } = federate({`,
		`\tname: 'app',`,
		`\tkey: env.APP_SIGNING_KEY,`,
		`\tvisitor: () => ({ sub: 'visitor' }),`,
		`\tpeers: { peer: { origin: env.PEER_ORIGIN ?? 'https://peer.test', key: env.PEER_PUBLIC_KEY } }`,
		`});`,
		''
	].join('\n');
}

/** The app's server hook beside ogygia's (`src/lib/gen/mount.server.ts`): the peer's pages
 *  mounted under `/peer` by a server router, or nothing. */
function app_mount(peer: GenPeer | null): string {
	if (peer?.mount !== 'router')
		return [
			`import type { Handle } from '@sveltejs/kit';`,
			'',
			`export const handle: Handle = ({ event, resolve }) => resolve(event);`,
			''
		].join('\n');
	return [
		`import type { Handle } from '@sveltejs/kit';`,
		`import { routes } from '@ogygia/router';`,
		`import { mount } from '@ogygia/federation';`,
		`import { peer } from './federation.server.ts';`,
		'',
		`const mounted = routes({ '${MOUNT}/[...rest]': mount(peer) }, { base: '', visitor: () => ({ sub: 'visitor' }) });`,
		'',
		`export const handle: Handle = ({ event, resolve }) => mounted.handle({ event, resolve });`,
		''
	].join('\n');
}

/** Writes the region components of `roots` into `lib`. */
function components(lib: string, roots: readonly GenNode[]): void {
	const walk = (n: GenNode): void => {
		writeFileSync(join(lib, `N${n.id}.svelte`), component(n));
		if (n.kind === 'held' || n.kind === 'live') {
			writeFileSync(join(lib, `H${n.id}.svelte`), host(n));
			writeFileSync(join(lib, `h${n.id}.remote.ts`), remote(n));
		}
		n.children.forEach(walk);
	};
	roots.forEach(walk);
}

/** Writes `pages` into `app`: its routes (a nav to every page on each) and its region components;
 *  with a `peer`, the app's federation, its pages' slots and the mount of the peer's pages. */
export function write(
	app: string,
	pages: readonly GenPage[],
	seed: number,
	peer: GenPeer | null = null
): void {
	const routes = join(app, 'src', 'routes');
	const lib = join(app, 'src', 'lib', 'gen');
	rmSync(routes, { recursive: true, force: true });
	rmSync(lib, { recursive: true, force: true });
	mkdirSync(routes, { recursive: true });
	mkdirSync(lib, { recursive: true });
	const mounted = (peer?.pages ?? []).map((p) => MOUNT + p.path);
	const nav = ['/', ...pages.map((p) => p.path), ...mounted]
		.map((p) => `<a href="${p}">${p}</a>`)
		.join(' ');
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
	writeFileSync(join(lib, 'mount.server.ts'), app_mount(peer));
	if (peer) {
		writeFileSync(join(lib, 'federation.server.ts'), app_federation());
		if (peer.mount === 'kit') {
			const dir = join(routes, MOUNT.slice(1), '[...rest]');
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, '+page.server.ts'),
				[
					`import { mount } from '@ogygia/federation';`,
					`import { peer } from '$lib/gen/federation.server';`,
					'',
					`const m = mount.kit(peer, { user: () => ({ sub: 'visitor' }) });`,
					`export const load = m.load;`,
					`export const actions = m.actions;`,
					''
				].join('\n')
			);
			writeFileSync(
				join(dir, '+page.svelte'),
				[
					'<script lang="ts">',
					'\tlet { data } = $props();',
					'</script>',
					'',
					'<svelte:head>',
					'\t{#if data.doc.title}<title>{data.doc.title}</title>{/if}',
					"\t{@html data.doc.css.join('') + (data.doc.head ?? '')}",
					'</svelte:head>',
					'',
					'{@html data.doc.body}',
					''
				].join('\n')
			);
		}
	}
	for (const page of pages) {
		const dir = join(routes, page.path.slice(1));
		mkdirSync(dir, { recursive: true });
		const slots = (peer?.slots ?? []).filter((s) => s.page === page.path);
		const imports = page.roots.map(
			(n) => `\timport ${name(n)} from '$lib/gen/${name(n)}.svelte'${attributes(n)};`
		);
		if (slots.length > 0) {
			imports.push(`\timport { Region } from 'ogygia';`, `\tlet { data } = $props();`);
			writeFileSync(
				join(dir, '+page.server.ts'),
				[
					`import { peer } from '$lib/gen/federation.server';`,
					'',
					`export const load = async () => ({`,
					...slots.map(
						(s) =>
							`\tr${s.id}: await peer.widget('${s.widget}', { label: 'r${s.id}' }, { render: '${s.render}' }),`
					),
					`});`,
					''
				].join('\n')
			);
		}
		writeFileSync(
			join(dir, '+page.svelte'),
			[
				'<script lang="ts">',
				...imports,
				'</script>',
				'',
				`<h1>${page.path}</h1>`,
				...page.roots.map((n) => usage(n, '')),
				...slots.map(slot_usage),
				''
			].join('\n')
		);
		components(lib, page.roots);
	}
	writeFileSync(join(lib, 'plan.json'), JSON.stringify({ seed, pages, peer }, null, '\t') + '\n');
}

/** Writes `peer` into the peer app `dir` (apps/sim-gen-peer): its widgets and pages, the router
 *  that exposes the pages, and its federation (`src/lib/gen/federation.server.ts`). */
export function write_peer(dir: string, peer: GenPeer, seed: number): void {
	const lib = join(dir, 'src', 'lib', 'gen');
	rmSync(lib, { recursive: true, force: true });
	mkdirSync(lib, { recursive: true });
	const nav = ['/', ...peer.pages.map((p) => MOUNT + p.path)]
		.map((p) => `<a href="${p}">${p}</a>`)
		.join(' ');
	for (const w of peer.widgets) {
		writeFileSync(
			join(lib, `W${w.name}.svelte`),
			[
				'<script lang="ts">',
				...w.children.map((c) => `\timport ${name(c)} from './${name(c)}.svelte'${attributes(c)};`),
				"\tlet { label = '' }: { label?: string } = $props();",
				'</script>',
				'',
				`<section data-gen="widget">`,
				`\t<span>${w.name} for {label}</span>`,
				...w.children.map((c) => usage(c, '\t')),
				'</section>',
				''
			].join('\n')
		);
		components(lib, w.children);
	}
	for (const [i, p] of peer.pages.entries()) {
		writeFileSync(
			join(lib, `Q${i}.svelte`),
			[
				'<script lang="ts">',
				...p.roots.map((n) => `\timport ${name(n)} from './${name(n)}.svelte'${attributes(n)};`),
				'</script>',
				'',
				`<nav>${nav}</nav>`,
				`<h1>peer ${p.path}</h1>`,
				...p.roots.map((n) => usage(n, '')),
				''
			].join('\n')
		);
		components(lib, p.roots);
	}
	writeFileSync(
		join(lib, 'router.ts'),
		[
			`import { routes, page } from '@ogygia/router';`,
			...peer.pages.map((_, i) => `import Q${i} from './Q${i}.svelte';`),
			'',
			`export const router = routes(`,
			`\t{`,
			...peer.pages.map((p, i) => `\t\t'${p.path}': page(Q${i}),`),
			`\t},`,
			`\t{ base: '${MOUNT}' }`,
			`);`,
			''
		].join('\n')
	);
	writeFileSync(
		join(lib, 'federation.server.ts'),
		[
			`import { federate } from '@ogygia/federation';`,
			`import { region } from 'ogygia';`,
			`import { env } from '$env/dynamic/private';`,
			`import { router } from './router.ts';`,
			...peer.widgets.map(
				(w) => `import W${w.name} from './W${w.name}.svelte' with { region: 'raw' };`
			),
			'',
			`federate({`,
			`\tname: 'peer',`,
			`\tkey: env.PEER_SIGNING_KEY,`,
			`\tbase: '${MOUNT}',`,
			`\texpose: router,`,
			`\tpeers: { app: { origin: env.APP_ORIGIN ?? 'https://app.test', key: env.APP_PUBLIC_KEY } },`,
			`\twidgets: {`,
			...peer.widgets.map(
				(w) => `\t\t${w.name}: (props) => region(W${w.name}, { label: String(props.label ?? '') }),`
			),
			`\t}`,
			`});`,
			''
		].join('\n')
	);
	writeFileSync(join(lib, 'plan.json'), JSON.stringify({ seed, peer }, null, '\t') + '\n');
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
	const peer = peer_plan(seed, pages);
	write(app, pages, seed, peer);
	const count = (ns: readonly GenNode[]): number =>
		ns.reduce((s, n) => s + 1 + count(n.children), 0);
	console.log(
		`[sim] generated ${pages.length} pages, ${count(pages.flatMap((p) => p.roots))} regions (seed ${seed}) in ${app}`
	);
	if (peer) {
		write_peer(`${app}-peer`, peer, seed);
		console.log(
			`[sim] and its peer: ${peer.widgets.length} widgets in ${peer.slots.length} slots (${peer.slots.filter((s) => s.render === 'deferred').length} deferred), ${peer.pages.length} pages mounted by ${peer.mount === 'router' ? 'a server router' : 'a Kit catchall'} in ${app}-peer`
		);
	}
}

if (import.meta.main) main();
