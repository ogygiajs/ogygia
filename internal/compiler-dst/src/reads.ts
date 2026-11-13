/**
 * WHAT A COMPONENT READS OF `page.data`, AND WHAT IT REALLY READ. Seed shaping (`dataShake()`,
 * packages/data-shake/src/analysis.ts) predicts the top-level `page.data` keys a module can reach, and the server ships
 * only those to an island: a key read but not predicted is a value the island never sees. Here a
 * component is drawn from read shapes (a member, a computed literal, destructuring, an alias, a local
 * helper, optional chaining, a spread, a computed key), compiled for the server by Svelte, and
 * rendered with `page.data` a Proxy that records each key read. The oracle: read within predicted
 * (`'all'` predicts every key).
 */
import fc from 'fast-check';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { KNOWN } from './dev.ts';

export const KEYS = ['a', 'b', 'c', 'd'] as const;
type Key = (typeof KEYS)[number];

export type Read =
	| { kind: 'member'; key: Key }
	| { kind: 'literal'; key: Key }
	| { kind: 'optional'; key: Key }
	| { kind: 'destructure'; keys: Key[] }
	| { kind: 'alias'; key: Key }
	| { kind: 'helper'; key: Key }
	| { kind: 'derived'; key: Key }
	| { kind: 'spread' }
	| { kind: 'computed'; key: Key }
	| { kind: 'markup'; key: Key }
	| { kind: 'nested'; key: Key }
	| { kind: 'bracket-data'; key: Key }
	| { kind: 'param-destructure'; key: Key }
	| { kind: 'param-default'; key: Key }
	| { kind: 'derived-alias'; key: Key }
	| { kind: 'store'; key: Key };

/** Read shapes a filed bug explains (dev.ts `KNOWN`): not drawn until it is fixed. */
const KNOWN_READS: Partial<Record<Read['kind'], number>> = {
	// a page passed as a parameter's default
	'param-default': 1317
};

const key = fc.constantFrom(...KEYS);
export const read: fc.Arbitrary<Read> = fc.oneof(
	fc.record({ kind: fc.constant('member' as const), key }),
	fc.record({ kind: fc.constant('literal' as const), key }),
	fc.record({ kind: fc.constant('optional' as const), key }),
	fc.record({
		kind: fc.constant('destructure' as const),
		keys: fc.uniqueArray(key, { minLength: 1, maxLength: 3 })
	}),
	fc.record({ kind: fc.constant('alias' as const), key }),
	fc.record({ kind: fc.constant('helper' as const), key }),
	fc.record({ kind: fc.constant('derived' as const), key }),
	fc.record({ kind: fc.constant('spread' as const) }),
	fc.record({ kind: fc.constant('computed' as const), key }),
	...(
		[
			'markup',
			'nested',
			'bracket-data',
			'param-destructure',
			'param-default',
			'derived-alias',
			'store'
		] as const
	)
		.filter((kind) => !(kind in KNOWN_READS && KNOWN.has(KNOWN_READS[kind]!)))
		.map((kind) => fc.record({ kind: fc.constant(kind), key }))
);

/** One read as script lines and the expressions it shows, `i` keeping its names apart. */
function lines(r: Read, i: number): { script: string[]; shown: string[] } {
	const v = `v${i}`;
	switch (r.kind) {
		case 'member':
			return { script: [`const ${v} = page.data.${r.key};`], shown: [v] };
		case 'literal':
			return { script: [`const ${v} = page.data['${r.key}'];`], shown: [v] };
		case 'optional':
			return { script: [`const ${v} = page.data?.${r.key};`], shown: [v] };
		case 'destructure':
			return {
				script: [`const { ${r.keys.map((k) => `${k}: ${v}_${k}`).join(', ')} } = page.data;`],
				shown: r.keys.map((k) => `${v}_${k}`)
			};
		case 'alias':
			return { script: [`const ${v}_d = page.data;`, `const ${v} = ${v}_d.${r.key};`], shown: [v] };
		case 'helper':
			return {
				script: [
					`function ${v}_get(p) { return p.data.${r.key}; }`,
					`const ${v} = ${v}_get(page);`
				],
				shown: [v]
			};
		case 'derived':
			return { script: [`const ${v} = $derived(page.data.${r.key});`], shown: [v] };
		case 'spread':
			return { script: [`const ${v} = { ...page.data };`], shown: [`Object.keys(${v}).length`] };
		case 'computed':
			return {
				script: [`const ${v}_k = ['${r.key}'][0];`, `const ${v} = page.data[${v}_k];`],
				shown: [v]
			};
		case 'markup':
			return { script: [], shown: [`page.data.${r.key}`] };
		case 'nested':
			return { script: [`const ${v} = page.data.${r.key}?.inner;`], shown: [v] };
		case 'bracket-data':
			return { script: [`const ${v} = page['data'].${r.key};`], shown: [v] };
		case 'param-destructure':
			return {
				script: [
					`function ${v}_get({ data }) { return data.${r.key}; }`,
					`const ${v} = ${v}_get(page);`
				],
				shown: [v]
			};
		case 'param-default':
			return {
				script: [
					`function ${v}_get(p = page) { return p.data.${r.key}; }`,
					`const ${v} = ${v}_get();`
				],
				shown: [v]
			};
		case 'derived-alias':
			return {
				script: [`const ${v}_d = $derived(page.data);`, `const ${v} = $derived(${v}_d.${r.key});`],
				shown: [v]
			};
		case 'store':
			return { script: [], shown: [`$store_page.data.${r.key}`] };
	}
}

/** A component that makes `reads`, importing Kit's page from `$app/state`. */
export function component(reads: readonly Read[]): string {
	const parts = reads.map(lines);
	return [
		'<script>',
		`import { page } from '$app/state';`,
		...(reads.some((r) => r.kind === 'store')
			? [`import { page as store_page } from '$app/stores';`]
			: []),
		...parts.flatMap((p) => p.script),
		'</script>',
		...parts.flatMap((p) => p.shown).map((e) => `<p>{String(${e})}</p>`),
		''
	].join('\n');
}

const STUB = '__dst_app_state__';
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The top-level `page.data` keys the component really read, rendered on the server once. */
export async function really_read(source: string): Promise<Set<string>> {
	const js = compile(source, { generate: 'server', filename: 'Reads.svelte' })
		.js.code.replace(/(['"])\$app\/state\1/, JSON.stringify(`./${STUB}.js`))
		.replace(/(['"])\$app\/stores\1/, JSON.stringify(`./${STUB}-stores.js`));
	// (inside the package, so `svelte/internal/server` resolves from its own node_modules)
	const dir = mkdtempSync(path.join(HERE, '..', '.reads-'));
	const seen = new Set<string>();
	const data = new Proxy({} as Record<string, unknown>, {
		get(_t, k) {
			if (typeof k === 'string') seen.add(k);
			return undefined;
		},
		ownKeys() {
			seen.add('*');
			return [];
		},
		getOwnPropertyDescriptor(_t, k) {
			if (typeof k === 'string') seen.add(k);
			return undefined;
		}
	});
	try {
		writeFileSync(path.join(dir, `${STUB}.js`), 'export const page = globalThis.__dst_page;\n');
		writeFileSync(
			path.join(dir, `${STUB}-stores.js`),
			'export const page = { subscribe(run) { run(globalThis.__dst_page); return () => {}; } };\n'
		);
		writeFileSync(path.join(dir, 'Reads.js'), js);
		(globalThis as Record<string, unknown>).__dst_page = { data };
		const mod = (await import(pathToFileURL(path.join(dir, 'Reads.js')).href)) as {
			default: Parameters<typeof render>[0];
		};
		// (the render runs when its body is read)
		void render(mod.default, { props: {} }).body;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return seen;
}
