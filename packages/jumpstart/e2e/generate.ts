/**
 * WRITES THE FIXTURE APPS' GENERATED SOURCE, run once by hand; the output is committed (the bench
 * app's is gitignored and written by the bench itself). e2e/app/src holds the hand-written files: the
 * light pages (`/`, `/about`), the CMS page (`/p/<n>`), a page marking one region in its own markup
 * (`/inline`), a page with a server hole (`/hole`) and one importing a dependency that reads a file
 * beside itself (`/file`). This writes the research fixture's block registry
 * (internal/notes/design/server-chunks.md) beside them: `src/lib/registry.ts`, whose blocks are each
 * a region that wakes when visible, with their UI parts, icons and utils under `src/lib/gen`. The
 * other apps get e2e/app's hand-written files copied. Seeded: the same command writes the same files.
 *
 *   node e2e/generate.ts          e2e/app and e2e/app-kit3 (24 blocks), e2e/deps/many-files
 *   node e2e/generate.ts bench    e2e/bench-app (225 blocks, the research size)
 */
import fs from 'node:fs';
import path from 'node:path';
import { dedent } from '@ogygia/core/plugin/utils';

const E2E = import.meta.dirname;
const HAND_WRITTEN = path.join(E2E, 'app/src');
const ICONS = 60;
const UI = 30;
const UTILS = 12;
/** Files in the `many-files` dependency: one function each, like a date library. */
export const MANY = 120;

class Seeded {
	#seed: number;
	constructor(seed: number) {
		this.#seed = seed;
	}
	next(): number {
		this.#seed = (this.#seed + 0x6d2b79f5) >>> 0;
		let t = this.#seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	int(n: number): number {
		return Math.floor(this.next() * n);
	}
	some(count: number, of: number): number[] {
		const out = new Set<number>();
		while (out.size < Math.min(count, of)) out.add(this.int(of));
		return [...out].sort((a, b) => a - b);
	}
}

const pad = (n: number): string => String(n).padStart(3, '0');
const lines = (xs: readonly string[]): string => xs.join('\n');

/** One app's generated source. */
class AppSource {
	readonly #dir: string;
	readonly #blocks: number;
	readonly #r = new Seeded(7);

	constructor(dir: string, blocks: number) {
		this.#dir = dir;
		this.#blocks = blocks;
	}

	write(): void {
		const src = path.join(this.#dir, 'src');
		if (src !== HAND_WRITTEN) {
			fs.rmSync(src, { recursive: true, force: true });
			fs.cpSync(HAND_WRITTEN, src, {
				recursive: true,
				filter: (from) => !from.includes(`${path.sep}gen`) && !from.endsWith('registry.ts')
			});
		}
		fs.rmSync(path.join(src, 'lib/gen'), { recursive: true, force: true });
		this.#registry();
	}

	#put(rel: string, text: string): void {
		const at = path.join(this.#dir, 'src', rel);
		fs.mkdirSync(path.dirname(at), { recursive: true });
		fs.writeFileSync(at, `${text}\n`);
	}

	#registry(): void {
		const r = this.#r;
		for (let i = 0; i < ICONS; i++)
			this.#put(
				`lib/gen/icons/I${pad(i)}.svelte`,
				dedent`
					<script>
						let { size = 16, label } = $props();
					</script>

					<svg width={size} height={size} viewBox="0 0 24 24" aria-label={label} role="img"><path d="M${r.int(24)} ${r.int(24)}L${r.int(24)} ${r.int(24)}" /></svg>
				`
			);
		for (let i = 0; i < UTILS; i++) {
			const fns = r.some(3, MANY).map((k) => `f${pad(k)}`);
			const work =
				i % 4 === 3
					? 'for (let k = 0; k < 2000; k++) TABLE.set(`k${k}`, (k * 2654435761) >>> 0);'
					: '';
			this.#put(
				`lib/gen/util/u${pad(i)}.js`,
				dedent`
					import { ${fns.join(', ')} } from 'jumpstart-e2e-many-files';

					const TABLE = new Map();
					${work}

					export function u${pad(i)}(n) {
						return [${fns.map((f) => `${f}(n)`).join(', ')}].join(' ').concat(' #', String(TABLE.get(\`k\${n % 2000}\`) ?? 0));
					}
				`
			);
		}
		for (let i = 0; i < UI; i++) {
			const icons = r.some(1 + r.int(3), ICONS);
			const util = r.int(UTILS);
			this.#put(
				`lib/gen/ui/U${pad(i)}.svelte`,
				dedent`
					<script>
					${lines(icons.map((k) => `\timport I${pad(k)} from '../icons/I${pad(k)}.svelte';`))}
						import { u${pad(util)} } from '../util/u${pad(util)}.js';

						let { item } = $props();
					</script>

					<div class="ui-${i}">
					${lines(icons.map((k) => `\t<I${pad(k)} label="i${k}" />`))}
						<strong>{item.title}</strong>
						<small>{u${pad(util)}(item.n)}</small>
					</div>
				`
			);
		}
		const names: string[] = [];
		for (let i = 0; i < this.#blocks; i++) {
			const ui = r.some(2 + r.int(3), UI);
			const icons = r.some(2 + r.int(3), ICONS);
			const name = `B${pad(i)}`;
			names.push(name);
			this.#put(
				`lib/gen/blocks/${name}.svelte`,
				dedent`
					<script>
					${lines(ui.map((k) => `\timport U${pad(k)} from '../ui/U${pad(k)}.svelte';`))}
					${lines(icons.map((k) => `\timport I${pad(k)} from '../icons/I${pad(k)}.svelte';`))}

						let { title, items } = $props();
						let open = $state(false);
					</script>

					<section class="block b${i}" data-block="${name}">
						<header>
					${lines(icons.map((k) => `\t\t<I${pad(k)} label="b${k}" />`))}
							<h2>{title}</h2>
							<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
						</header>
						<ul>
							{#each items as item, n (n)}
								<li>
					${lines(ui.map((k) => `\t\t\t\t<U${pad(k)} {item} />`))}
								</li>
							{/each}
						</ul>
					</section>
				`
			);
		}
		this.#put(
			'lib/registry.ts',
			dedent`
				${lines(names.map((b) => `import ${b} from './gen/blocks/${b}.svelte' with { wake: 'visible' };`))}

				export const registry = { ${names.join(', ')} };
				export const BLOCK_NAMES = Object.keys(registry);
			`
		);
	}
}

/** The `many-files` dependency's files (its package.json is committed by hand). */
function many_files(): void {
	const dir = path.join(E2E, 'deps/many-files');
	const names = Array.from({ length: MANY }, (_, i) => `f${pad(i)}`);
	fs.writeFileSync(
		path.join(dir, 'index.js'),
		`${lines(names.map((f) => `export { ${f} } from './${f}.js';`))}\n`
	);
	for (const [i, f] of names.entries())
		fs.writeFileSync(
			path.join(dir, `${f}.js`),
			`${dedent`
				export function ${f}(n) {
					return \`${f}:\${(n * ${i + 3}) % 101}\`;
				}
			`}\n`
		);
}

if (import.meta.main) {
	if (process.argv[2] === 'bench') new AppSource(path.join(E2E, 'bench-app'), 225).write();
	else {
		new AppSource(path.join(E2E, 'app'), 24).write();
		new AppSource(path.join(E2E, 'app-kit3'), 24).write();
		many_files();
	}
}
