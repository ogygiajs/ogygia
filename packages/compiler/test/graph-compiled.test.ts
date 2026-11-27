// vite/graph-compiled.ts: a module whose source is the whole bundle's answer (the server's feature
// word) loads only once the bundler has compiled every other module of it (#2165).
import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolldown, type Plugin } from 'rolldown';
import { dedent } from '@ogygia/core/contract';
import { graph_compiled } from '../src/vite/graph-compiled.ts';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-graph-compiled-')));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(files: Record<string, string>): void {
	for (const [name, source] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), `${source}\n`);
	}
}

const WAITING: ReadonlySet<string> = new Set(['\0virtual:word', '\0virtual:other']);
const WORD_RE = /"compiled before word: ([^"]*)"/;

/** A plugin whose two waiting modules each answer with the modules compiled before they loaded. */
function answers(): Plugin {
	const compiled = new Set<string>();
	return {
		name: 'answers',
		resolveId(source) {
			return source.startsWith('virtual:') ? `\0${source}` : null;
		},
		async load(id) {
			if (!WAITING.has(id)) return null;
			await graph_compiled(this, (m) => WAITING.has(m));
			const seen = [...compiled].sort().join(',');
			return `export const word = "compiled before ${id.slice(9)}: ${seen}";\n`;
		},
		transform(_code, id) {
			if (id.startsWith(dir)) compiled.add(path.relative(dir, id));
			return null;
		}
	};
}

test('a waiting module loads after every other module has compiled: a dynamic import, its own imports, and an external among them (#2165)', async () => {
	write({
		'main.js': dedent`
			import { word } from 'virtual:word';
			import { a } from './a.js';
			import { sep } from 'node:path';
			console.log(word, a, sep);
			export const late = () => import('./late/one.js');
		`,
		'a.js': dedent`
			import { word } from 'virtual:other';
			export const a = word;
		`,
		'late/one.js': dedent`
			import { two } from './two.js';
			export const one = two;
		`,
		'late/two.js': dedent`
			import { readFileSync } from 'node:fs';
			export const two = readFileSync;
		`
	});
	const bundle = await rolldown({
		input: path.join(dir, 'main.js'),
		external: ['node:path', 'node:fs'],
		plugins: [answers()]
	});
	const { output } = await bundle.generate({ format: 'es' });
	await bundle.close();
	const code = output.map((c) => ('code' in c ? c.code : '')).join('\n');
	expect(WORD_RE.exec(code)?.[1]).toBe(['a.js', 'late/one.js', 'late/two.js', 'main.js'].join(','));
}, 20_000);

test('a waiting module waits for the imports of a module the bundler has parsed but whose imports it has not yet started (#2192: on CI the feature word read only main.js)', async () => {
	write({
		'main.js': dedent`
			import { a } from './a.js';
			console.log(a);
		`,
		'a.js': dedent`
			import { b } from './b.js';
			export const a = b;
		`,
		'b.js': 'export const b = 1;'
	});
	const main = path.join(dir, 'main.js');
	const parsed = Promise.withResolvers<void>();
	const compiled = new Set<string>();
	const bundle = await rolldown({
		input: { main, word: 'virtual:word' },
		plugins: [
			{
				name: 'answers',
				resolveId(source) {
					return source === 'virtual:word' ? '\0virtual:word' : null;
				},
				async load(id) {
					if (id !== '\0virtual:word') return null;
					await parsed.promise;
					await graph_compiled(this, (m) => m === id);
					return `export const word = "compiled before word: ${[...compiled].sort().join(',')}";\n`;
				},
				transform(_code, id) {
					if (id.startsWith(dir)) compiled.add(path.relative(dir, id));
					return null;
				},
				async moduleParsed(info) {
					if (info.id !== main) return;
					parsed.resolve();
					await new Promise((settle) => setTimeout(settle, 100));
				}
			}
		]
	});
	const { output } = await bundle.generate({ format: 'es' });
	await bundle.close();
	const code = output.map((c) => ('code' in c ? c.code : '')).join('\n');
	expect(WORD_RE.exec(code)?.[1]).toBe(['a.js', 'b.js', 'main.js'].join(','));
}, 20_000);

interface Held {
	files: Record<string, string>;
	resolveId?: (source: string, importer: string | undefined) => ResolveIdResult;
	/** ms the waiting module waits after `main.js` is parsed, before it waits for the graph */
	after?: number;
	quiet?: number;
	main_parsed?: () => void;
}
type ResolveIdResult =
	| string
	| { id: string; external?: boolean; moduleSideEffects?: boolean }
	| null;

/** A build of `{ main, word }` whose word waits for the graph while `main.js` sits in its
 *  `moduleParsed` hook for 100 ms: the bundler has named `main.js`'s imports but not begun them. */
async function held_build(o: Held): Promise<string> {
	write(o.files);
	const main = path.join(dir, 'main.js');
	const parsed = Promise.withResolvers<void>();
	const bundle = await rolldown({
		input: { main, word: 'virtual:word' },
		logLevel: 'silent',
		plugins: [
			{
				name: 'resolver',
				resolveId: (source, importer) => o.resolveId?.(source, importer) ?? null
			},
			{
				name: 'held',
				resolveId(source) {
					return source === 'virtual:word' ? '\0virtual:word' : null;
				},
				async load(id) {
					if (id !== '\0virtual:word') return null;
					await parsed.promise;
					if (o.after) await new Promise((settle) => setTimeout(settle, o.after));
					await graph_compiled(this, (m) => m === id, o.quiet);
					return 'export const word = 1;\n';
				},
				async moduleParsed(info) {
					if (info.id !== main) return;
					parsed.resolve();
					o.main_parsed?.();
					await new Promise((settle) => setTimeout(settle, 100));
				}
			}
		]
	});
	try {
		const { output } = await bundle.generate({ format: 'es' });
		return output.map((c) => ('code' in c ? c.code : '')).join('\n');
	} finally {
		await bundle.close();
	}
}

test('a waiting module starts no import\'s load itself: an import resolveId marks side-effect free, and a package whose package.json says "sideEffects": false, stay tree-shaken', async () => {
	const code = await held_build({
		files: {
			'main.js': dedent`
				import { a } from './a.js';
				import 'pkg';
				import { c } from './c.js';
				console.log('MAIN_SIDE');
			`,
			'a.js': "console.log('A_SIDE');\nexport const a = 1;",
			'c.js': "console.log('C_SIDE');\nexport const c = 1;",
			'node_modules/pkg/package.json': JSON.stringify({
				name: 'pkg',
				sideEffects: false,
				main: 'index.js'
			}),
			'node_modules/pkg/index.js': "console.log('PKG_SIDE');\nexport const p = 1;"
		},
		resolveId: (source) =>
			source === './a.js' ? { id: path.join(dir, 'a.js'), moduleSideEffects: false } : null
	});
	expect(['MAIN_SIDE', 'A_SIDE', 'PKG_SIDE', 'C_SIDE'].filter((s) => code.includes(s))).toEqual([
		'MAIN_SIDE',
		'C_SIDE'
	]);
}, 20_000);

const ext_main = {
	'main.js': dedent`
		import { x } from 'ext-thing';
		console.log(x);
	`
};
const ext_only_with_importer = (source: string, importer: string | undefined): ResolveIdResult =>
	source === 'ext-thing' && importer ? { id: 'ext-thing', external: true } : null;

test('a waiting module builds with an external that resolveId marks only for an importer, while the bundler has named it but not listed it', async () => {
	const code = await held_build({ files: ext_main, resolveId: ext_only_with_importer });
	expect(code).toContain('from "ext-thing"');
}, 20_000);

test('a waiting module builds with an external that resolveId marks only for an importer, once the bundler has listed it (#2167 re-resolved it with no importer and waited forever)', async () => {
	const code = await held_build({ files: ext_main, resolveId: ext_only_with_importer, after: 300 });
	expect(code).toContain('from "ext-thing"');
}, 20_000);

test('a waiting module settles when an importer fails in moduleParsed, so the build reports that failure', async () => {
	const build = held_build({
		files: {
			'main.js': dedent`
				import { a } from './a.js';
				console.log(a);
			`,
			'a.js': 'export const a = 1;'
		},
		quiet: 500,
		main_parsed: () => {
			throw new Error('main.js failed in moduleParsed');
		}
	});
	await expect(build).rejects.toThrow('main.js failed in moduleParsed');
}, 20_000);
