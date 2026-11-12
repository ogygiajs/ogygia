// Seed shaping must be SOUND: a key it leaves out is missing from the shipped page seed, and the island
// reads `undefined` there. Each script below really runs, with a recording Proxy as `page.data`
// and a `use()` that reads all of whatever it is handed (a function the analysis cannot see into),
// and the analysis must answer 'all' or a set holding every key that was read. One shape at a time,
// then generated mixes of them (seeded 314; OGYGIA_FUZZ_SEED, OGYGIA_FUZZ_RUNS).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import {
	page_data_keys,
	page_data_keys_answer,
	summarize_export
} from '../src/analysis.ts';
import { dedent } from '@ogygia/core/contract';

const KEYS = ['a', 'b', 'c'];
let fresh = 0;
const v = () => `v${fresh++}`;

/** One read of `page.data` per shape; `k` is the key it reads. */
const SHAPES: ((k: string) => string)[] = [
	(k) => `use(page.data.${k});`,
	(k) => `use(page.data?.${k});`,
	(k) => `use(page.data['${k}']);`,
	(k) => `use(page.data[\`${k}\`]);`,
	(k) => `use(page['data'].${k});`,
	(k) => `use(page?.data?.${k});`,
	(k) => `use((page.data).${k});`,
	(k) => `use(page.data.${k}?.x);`,
	(k) => `use(page.data.${k}.toString());`,
	(k) => `use(page.data.${k} = page.data.${k});`,
	(k) => `use(page.data.hasOwnProperty('${k}'));`,
	(k) => `use(page.data.valueOf().${k});`,
	(k) => `use('${k}' in page.data);`,
	(k) => `use(Object.hasOwn(page.data, '${k}'));`,
	(k) => `use(Reflect.get(page.data, '${k}'));`,
	(k) => `use(page.data[('${k}')]);`,
	(k) => `use(page.data.${k}, page.data);`,
	(k) => `use([page][0].data.${k});`,
	(k) => `use([page.data][0].${k});`,
	(k) => `use(((x) => x)(page.data).${k});`,
	() => `use(Object.keys(page.data));`,
	() => `use({ ...page.data });`,
	() => `use(JSON.stringify(page.data));`,
	() => `use([page]);`,
	() => `for (const ${v()} in page.data) use(0);`,
	(k) => {
		const d = v();
		return `const ${d} = page.data; use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `let ${d}; ${d} = page.data; use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `const { ${k}: ${d} } = page.data; use(${d});`;
	},
	(k) => {
		const d = v();
		return `const { ${k}: ${d}, ...${v()} } = page.data; use(${d});`;
	},
	(k) => {
		const d = v();
		return `const { data: { ${k}: ${d} } } = page; use(${d});`;
	},
	(k) => {
		const d = v();
		return `const { data: ${d} } = page; use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = page; use(${d}.data.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = '${k}'; use(page.data[${d}]);`;
	},
	(k) => {
		const f = v();
		return `function ${f}(o) { return o.${k}; } use(${f}(page.data));`;
	},
	(k) => {
		const f = v();
		return `const ${f} = (o) => o.data.${k}; use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `function ${f}({ data }) { return data.${k}; } use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `const ${f} = () => page.data.${k}; use(${f}());`;
	},
	(k) => {
		const d = v();
		return `const [${d}] = [page.data]; use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = [page]; use(${d}[0].data.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = { p: page }; use(${d}.p.data.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = page.data ?? {}; use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = true ? page.data : null; use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = (0, page.data); use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `let ${d}; ({ ${k}: ${d} } = page.data); use(${d});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = page.data; { const ${d} = { z: 1 }; use(${d}.z); } use(${d}.${k});`;
	},
	(k) => {
		const d = v();
		return `const ${d} = { get x() { return page.data.${k}; } }; use(${d}.x);`;
	},
	(k) => {
		const d = v();
		return `class ${d.toUpperCase()} { m() { return page.data.${k}; } } use(new ${d.toUpperCase()}().m());`;
	},
	(k) => {
		const f = v();
		return `function ${f}(p) { return arguments[0].data.${k}; } use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `function ${f}(p, q = p.data.${k}) { return q; } use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `function ${f}(p) { const q = p; return q.data.${k}; } use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `let ${f} = (p) => p.url; ${f} = (p) => p.data.${k}; use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `function ${f}(p) { return p.url; } ${f} = (p) => p.data.${k}; use(${f}(page));`;
	},
	(k) => {
		const f = v();
		return `function ${f}(p = page) { return p.data.${k}; } use(${f}());`;
	},
	(k) => {
		const f = v();
		return `function ${f}({ data } = page) { return data.${k}; } use(${f}());`;
	},
	(k) => {
		const f = v();
		return `const ${f} = (o = page.data) => o.${k}; use(${f}());`;
	},
	(k) => {
		const f = v();
		const g = v();
		return `function ${f}(p) { return p.url; } function ${g}() { const ${f} = (p) => p.data.${k}; return ${f}(page); } use(${g}());`;
	},
	(k) => `{ const window = undefined; use(typeof window === 'undefined' ? page.data.${k} : 0); }`
];

/** Runs `body` with a recording `page.data`: the keys it read, or `all` when it listed them. */
function trace(body: string): { all: boolean; keys: Set<string> } {
	const seen = { all: false, keys: new Set<string>() };
	const note = (k: string | symbol) => {
		if (typeof k === 'string' && KEYS.includes(k)) seen.keys.add(k);
	};
	const data = new Proxy({ a: { x: 1 }, b: 2, c: 'c' } as Record<string, unknown>, {
		get: (t, k, r) => (note(k), Reflect.get(t, k, r)),
		has: (t, k) => (note(k), Reflect.has(t, k)),
		getOwnPropertyDescriptor: (t, k) => (note(k), Reflect.getOwnPropertyDescriptor(t, k)),
		ownKeys: (t) => ((seen.all = true), Reflect.ownKeys(t))
	});
	const page = { data, url: new URL('https://example.com/'), params: {} };
	const use = (...xs: unknown[]) => {
		for (const x of xs) if (x && typeof x === 'object') JSON.stringify(x);
	};
	new Function('page', 'use', body)(page, use);
	return seen;
}

/** The analysis answer for `body` as a module, and whether it covers what `body` really read. */
function judge(body: string) {
	const code = dedent`
		import { page } from '$app/state';
		const use = globalThis.use;
		${body}
	`;
	const answer = page_data_keys(code, '/app/src/lib/x.ts', 'script');
	const seen = trace(body);
	const covered =
		answer === 'all' || (!seen.all && [...seen.keys].every((k) => answer?.has(k) === true));
	return { answer: answer === 'all' ? 'all' : [...(answer ?? [])].sort(), seen, covered };
}

describe('page.data seed shaping is sound', () => {
	it.each(SHAPES.map((shape) => [((fresh = 0), shape('b'))]))('%s', (body) => {
		const { answer, seen, covered } = judge(body);
		expect(
			covered,
			`answered ${JSON.stringify(answer)}, read ${JSON.stringify([...seen.keys])}`
		).toBe(true);
	});

	it('over generated mixes of the shapes', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.nat(SHAPES.length - 1), fc.constantFrom(...KEYS)), {
					minLength: 1,
					maxLength: 4
				}),
				(picks) => {
					fresh = 0;
					const body = picks.map(([i, k]) => SHAPES[i](k)).join('\n');
					const { answer, seen, covered } = judge(body);
					expect(
						covered,
						`${body}\nanswered ${JSON.stringify(answer)}, read ${JSON.stringify([...seen.keys])}`
					).toBe(true);
				}
			),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 314),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 300)
			}
		);
	});
});

/** Imported helpers: `summarize_export` must cover what `h(page)` really reads. */
const HELPERS = [
	'export function h(p) { return p.data.b; }',
	'export const h = (p) => p.data?.b;',
	'export function h(p) { const q = p; return q.data.b; }',
	'export function h(p) { let q; q = p; return q.data.b; }',
	'export function h(p) { const d = p.data; return d.b; }',
	'export function h(p, q = p.data.b) { return q; }',
	'export const h = (p, { b } = p.data) => b;',
	'export function h(p) { return arguments[0].data.b; }',
	'export function h(p) { const r = arguments; return r[0].data.b; }',
	'export function h(p) { function inner() { return p.data.b; } return inner(); }',
	'export function h(p) { return [p][0].data.b; }',
	'export function h(...ps) { return ps[0].data.b; }',
	'export let h = (p) => p.url; h = (p) => p.data.b;',
	'export function h(p) { return p.url; } h = (p) => p.data.b;',
	'function h(p) { return p.url; } export { h }; h = (p) => p.data.b;',
	'function g(p) { return p.data.b; } export { g as h };'
];

describe('an imported helper handed the page is summarized soundly', () => {
	it.each(HELPERS)('%s', (code) => {
		const summary = summarize_export(code, '/app/src/lib/h.ts', 'script', 'h', 0);
		const seen = { all: false, keys: new Set<string>() };
		const data = new Proxy({ a: 1, b: 2, c: 3 } as Record<string, unknown>, {
			get: (t, k, r) => (typeof k === 'string' && seen.keys.add(k), Reflect.get(t, k, r)),
			ownKeys: (t) => ((seen.all = true), Reflect.ownKeys(t))
		});
		const runnable = code.replace(/\bexport \{[^}]*\};?/g, '').replace(/\bexport /g, '');
		const exported = /export \{ g as h \}/.test(code) ? 'g' : 'h';
		new Function('page', `${runnable}\nreturn ${exported}(page);`)({ data, url: '/' });
		const read = [...seen.keys].filter((k) => KEYS.includes(k));
		const covered =
			summary === 'all' ||
			('follow' in summary ? false : !seen.all && read.every((k) => summary.has(k)));
		expect(
			covered,
			`summarized ${JSON.stringify(summary === 'all' ? 'all' : [...(summary as Set<string>)])}, read ${read}`
		).toBe(true);
	});
});

/** The page store leaving a module without an import declaration: a barrel's re-export, a dynamic
 *  `import()`. Whoever reads through it never names `$app/…`, so this module must answer 'all'. */
const PASSED_ON = [
	"export { page } from '$app/state';",
	"export { page as p } from '$app/stores';",
	"export * from '$app/state';",
	"export * as app from '$app/state';",
	"const { page } = await import('$app/state'); use(page.data.b);",
	"import('$app/stores').then((m) => use(m.page));",
	"import { getStores } from '$app/stores'; const { page } = getStores(); page.subscribe((p) => use(p.data.b));",
	"import { getStores as stores } from '$app/stores'; use(stores().page);",
	dedent`
		import { page } from '$app/state';
		export { page as p } from '$app/state';
		use(page.data.a);
	`
];

describe('the page store re-exported or imported dynamically', () => {
	it.each(PASSED_ON)('%s answers all', (code) => {
		expect(page_data_keys(code, '/app/src/lib/app.ts', 'script')).toBe('all');
	});

	it('a re-export of another name from the page module answers null', () => {
		expect(page_data_keys("export { navigating } from '$app/state';", '/x.ts', 'script')).toBe(
			null
		);
	});
});

/** `get` / `derived` are Svelte's store helpers only when they come from `svelte/store`. */
describe('a get() or derived() that is not svelte/store', () => {
	it.each([
		["import { get } from 'lodash-es';", "use(get(page, 'data.b').url);"],
		["import { get } from 'lodash-es';", "const v = get(page, 'data.b'); use(v.params);"],
		['function get(o, k) { return o.data[k]; }', "use(get(page, 'b').url);"],
		["import { derived } from './my-derived';", 'derived(page, (p) => p.url);'],
		[
			"import { derived } from 'svelte/store'; import { pick } from './pick';",
			'derived(page, pick);'
		],
		[
			"import { derived } from 'svelte/store';",
			'const pick = (p) => p.data.b; derived(page, pick);'
		]
	])('%s %s answers all or follows the call', (head, body) => {
		const code = dedent`
			import { page } from '$app/stores';
			${head}
			${body}
		`;
		const { keys, pending } = page_data_keys_answer(code, '/app/src/lib/x.ts', 'script');
		expect(keys === 'all' || pending.length > 0, JSON.stringify({ keys, pending })).toBe(true);
	});

	it.each([
		["import { get } from 'svelte/store';", 'use(get(page).data.b);'],
		["import { get as read } from 'svelte/store';", 'use(read(page).data.b);'],
		["import { derived } from 'svelte/store';", 'const d = derived(page, (p) => p.data.b);'],
		["import { derived as d } from 'svelte/store';", 'const s = d([page], ([p]) => p.data.b);']
	])('%s %s still reads b alone', (head, body) => {
		const code = dedent`
			import { page } from '$app/stores';
			${head}
			${body}
		`;
		expect(page_data_keys(code, '/app/src/lib/x.ts', 'script')).toEqual(new Set(['b']));
	});

	it('a followed helper reading through svelte/store get is still summarized', () => {
		const code = dedent`
			import { get } from 'svelte/store';
			export function h(p) { return get(p).data.b; }
		`;
		expect(summarize_export(code, '/app/src/lib/h.ts', 'script', 'h', 0)).toEqual(new Set(['b']));
	});
});
