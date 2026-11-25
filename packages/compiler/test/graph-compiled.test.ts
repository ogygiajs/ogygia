// vite/graph-compiled.ts: a module whose source is the whole bundle's answer (the server's feature
// word) loads only once the bundler has compiled every other module of it (#2165).
import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolldown, type Plugin } from 'rolldown';
import { dedent } from '@ogygia/core/contract';
import { graph_compiled } from '../src/vite/graph-compiled.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-graph-compiled-'));
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
			if (!WAITING.has(id)) compiled.add(path.relative(dir, id));
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
