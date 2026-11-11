/**
 * Writes the fixture's component tree into src/lib/gen/ (gitignored) and src/lib/registry.ts: the
 * shape of a CMS app's block registry. Deterministic (a seeded generator).
 *
 *   300 icons      tiny SVG components (an icon library is one file per icon)
 *   120 UI parts   shared by many blocks; each uses a few icons, a util, sometimes a smaller UI part
 *    40 utils      .ts helpers; some use date-fns, marked, zod or @floating-ui/dom; a few do work
 *                  at module top level (a lookup table, formatters): the side effects a merged
 *                  chunk would run for blocks a page never uses
 *   225 blocks     each imports 2-4 UI parts, 2-5 icons, 1-2 utils; 1 in 10 has module-level work
 *   registry.ts    imports every block `with { wake: 'visible' }`
 *
 *   node generate.ts [blocks=225]
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';

const BLOCKS = Number(process.argv[2] ?? 225);
const ICONS = 300;
const UI = 120;
const UTILS = 40;
const root = new URL('./src/lib/', import.meta.url);
const gen = new URL('gen/', root);

let seed = 7;
function r(): number {
	seed = (seed + 0x6d2b79f5) >>> 0;
	let t = seed;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (n: number): number => Math.floor(r() * n);
const pad = (n: number): string => String(n).padStart(3, '0');
function some(count: number, of: number): number[] {
	const out = new Set<number>();
	while (out.size < Math.min(count, of)) out.add(int(of));
	return [...out].sort((a, b) => a - b);
}

await rm(gen, { recursive: true, force: true });
for (const d of ['icons', 'ui', 'util', 'blocks'])
	await mkdir(new URL(d, gen), { recursive: true });

const writes: Promise<void>[] = [];
const put = (path: string, text: string): void => {
	writes.push(writeFile(new URL(path, gen), text));
};

for (let i = 0; i < ICONS; i++) {
	const d = Array.from(
		{ length: 2 + int(4) },
		() => `M${int(24)} ${int(24)}L${int(24)} ${int(24)}`
	).join(' ');
	put(
		`icons/I${pad(i)}.svelte`,
		`<script lang="ts">\n\tlet { size = 16, label }: { size?: number; label?: string } = $props();\n</script>\n\n` +
			`<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-label={label} role="img"><path d="${d}" /></svg>\n`
	);
}

const UTIL_KINDS = [
	(i: number) =>
		`import { format, parseISO, differenceInCalendarDays } from 'date-fns';\n\nexport function when_${i}(iso: string, now = '2026-11-01'): string {\n\tconst days = differenceInCalendarDays(parseISO(now), parseISO(iso));\n\treturn days < 7 ? days + ' days ago' : format(parseISO(iso), 'd MMM yyyy');\n}\n`,
	(i: number) =>
		`import { marked } from 'marked';\n\nexport function md_${i}(source: string): string {\n\treturn marked.parse(source, { async: false }) as string;\n}\n`,
	(i: number) =>
		`import { z } from 'zod';\n\nconst Item = z.object({ title: z.string(), n: z.number().int(), tags: z.array(z.string()).max(8) });\nexport function check_${i}(value: unknown): boolean {\n\treturn Item.safeParse(value).success;\n}\n`,
	(i: number) =>
		`import { computePosition } from '@floating-ui/dom';\n\nexport function placement_${i}(): string {\n\treturn typeof computePosition === 'function' ? 'bottom-start' : 'top';\n}\n`,
	(i: number) =>
		`// module-level work: runs when the module is evaluated, used or not\nconst TABLE: Map<string, number> = new Map();\nfor (let k = 0; k < 4000; k++) TABLE.set('k' + k, (k * 2654435761) >>> 0);\nconst MONEY = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });\n\nexport function price_${i}(n: number): string {\n\treturn MONEY.format(n / 100) + ' #' + (TABLE.get('k' + (n % 4000)) ?? 0);\n}\n`,
	(i: number) =>
		`export function slug_${i}(s: string): string {\n\treturn s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n}\nexport function clamp_${i}(n: number, lo = 0, hi = ${10 + i}): number {\n\treturn Math.min(hi, Math.max(lo, n));\n}\n`
];
const util_fn = (i: number): string =>
	['when', 'md', 'check', 'placement', 'price', 'slug'][i % UTIL_KINDS.length] + '_' + i;
for (let i = 0; i < UTILS; i++) put(`util/u${pad(i)}.ts`, UTIL_KINDS[i % UTIL_KINDS.length]!(i));

/** How a component calls util `i` in markup. */
function util_call(i: number, arg: string): string {
	switch (i % UTIL_KINDS.length) {
		case 0:
			return `when_${i}(${arg}.date)`;
		case 1:
			return `md_${i}(${arg}.body).length`;
		case 2:
			return `check_${i}({ title: ${arg}.title, n: ${arg}.n, tags: ${arg}.items })`;
		case 3:
			return `placement_${i}()`;
		case 4:
			return `price_${i}(${arg}.n * 100)`;
		default:
			return `slug_${i}(${arg}.title)`;
	}
}

for (let i = 0; i < UI; i++) {
	const icons = some(1 + int(3), ICONS);
	const util = int(UTILS);
	const child = i > 10 && r() < 0.4 ? int(i) : -1;
	put(
		`ui/U${pad(i)}.svelte`,
		`<script lang="ts">\n` +
			icons.map((k) => `\timport I${pad(k)} from '../icons/I${pad(k)}.svelte';\n`).join('') +
			(child >= 0 ? `\timport U${pad(child)} from './U${pad(child)}.svelte';\n` : '') +
			`\timport { ${util_fn(util)} } from '../util/u${pad(util)}.ts';\n` +
			`\timport type { Item } from '../../types.ts';\n\n` +
			`\tlet { item, tone = 'plain' }: { item: Item; tone?: string } = $props();\n</script>\n\n` +
			`<div class="ui-${i} {tone}">\n` +
			icons
				.map((k) => `\t<I${pad(k)} size={${12 + (k % 4) * 4}} label="${item_label(k)}" />\n`)
				.join('') +
			`\t<strong>{item.title}</strong>\n\t<small>{${util_call(util, 'item')}}</small>\n` +
			(child >= 0 ? `\t<U${pad(child)} {item} tone="nested" />\n` : '') +
			`</div>\n`
	);
}

function item_label(k: number): string {
	return ['open', 'close', 'next', 'back', 'info', 'star', 'cart', 'mail'][k % 8]!;
}

const registry: string[] = [];
for (let i = 0; i < BLOCKS; i++) {
	const ui = some(2 + int(3), UI);
	const icons = some(2 + int(4), ICONS);
	const utils = some(1 + int(2), UTILS);
	const module_work = i % 10 === 3;
	put(
		`blocks/B${pad(i)}.svelte`,
		(module_work
			? `<script lang="ts" module>\n\t// module-level work in a block: runs once its module is evaluated\n\tconst ROWS = Array.from({ length: 2000 }, (_, k) => ({ k, label: 'row ' + k, w: (k * 7919) % 101 }));\n\tconst HEAVIEST = ROWS.reduce((a, b) => (b.w > a.w ? b : a));\n</script>\n\n`
			: '') +
			`<script lang="ts">\n` +
			ui.map((k) => `\timport U${pad(k)} from '../ui/U${pad(k)}.svelte';\n`).join('') +
			icons.map((k) => `\timport I${pad(k)} from '../icons/I${pad(k)}.svelte';\n`).join('') +
			utils.map((k) => `\timport { ${util_fn(k)} } from '../util/u${pad(k)}.ts';\n`).join('') +
			`\timport type { Item } from '../../types.ts';\n\n` +
			`\tlet { title, items }: { title: string; items: Item[] } = $props();\n\tlet open = $state(false);\n</script>\n\n` +
			`<section class="block b${i}" data-block="B${pad(i)}">\n\t<header>\n` +
			icons.map((k) => `\t\t<I${pad(k)} label="${item_label(k)}" />\n`).join('') +
			`\t\t<h2>{title}</h2>\n\t\t<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>\n\t</header>\n` +
			`\t<ul>\n\t\t{#each items as item, n (n)}\n\t\t\t<li>\n` +
			ui
				.map((k, j) => `\t\t\t\t<U${pad(k)} {item} tone="${['plain', 'warm', 'cool'][j % 3]}" />\n`)
				.join('') +
			utils.map((k) => `\t\t\t\t<span>{${util_call(k, 'item')}}</span>\n`).join('') +
			`\t\t\t</li>\n\t\t{/each}\n\t</ul>\n` +
			(module_work ? `\t<footer>{HEAVIEST.label}</footer>\n` : '') +
			`\t{#if open}<p>{items.length} items</p>{/if}\n</section>\n`
	);
	registry.push(`B${pad(i)}`);
}

writes.push(
	writeFile(
		new URL('registry.ts', root),
		'// generated by generate.ts: every block, each a region that wakes when visible\n' +
			registry
				.map((b) => `import ${b} from './gen/blocks/${b}.svelte' with { wake: 'visible' };\n`)
				.join('') +
			`\nexport const registry = { ${registry.join(', ')} };\nexport type BlockName = keyof typeof registry;\nexport const BLOCK_NAMES = Object.keys(registry) as BlockName[];\n`
	)
);
await Promise.all(writes);
console.log(`generated ${ICONS} icons, ${UI} ui, ${UTILS} utils, ${BLOCKS} blocks`);
