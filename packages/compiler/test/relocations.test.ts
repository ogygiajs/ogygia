// VALUES KNOWN ONLY AT THE END OF A LEG (link/relocations.ts): every token a finished chunk carries is
// replaced, each patch is counted on the leg, and a leg whose output still holds a token, or holds
// the module that writes one with no patch counted, is said (`relocation_unpatched`).
import { describe, expect, test } from 'vitest';
import { Program } from '../src/program.ts';
import { V_FN_MANIFEST } from '../src/ids.ts';
import {
	LATE_SERVER_REGIONS_TOKEN,
	PAGE_DATA_READS_TOKEN,
	SERVER_MAP_TOKENS
} from '../src/link/server-manifest.ts';
import {
	WRITTEN_RELOCATIONS,
	relocate as relocate_table,
	relocations_of,
	unpatched,
	type RelocateCx
} from '../src/link/relocations.ts';
import { file_token } from '../src/link/file-token.ts';
import { ISLAND_DEPS_INLINE_TOKEN } from '../src/link/island-deps.ts';
import { code_fn } from './_code-fn.ts';

const FN = '/*__OGYGIA_FN_MANIFEST__*/';

/** A leg's relocations over a chunk: its patched text, or null. */
const relocate = (code: string, server: boolean, counts: Map<string, number>, c: RelocateCx) =>
	relocate_table(code, relocations_of(server), counts, c)?.s.toString() ?? null;

function cx(hoists: Record<string, string> = {}): RelocateCx {
	return {
		program: new Program({ forms: true, router: true }),
		dollar_hoists: new Map(Object.entries(hoists)),
		public_url: (iid) => `/_app/${iid}.js`,
		late_server_regions: new Map([['aaaaaaaaaaaa', 'ref1']]),
		chunk_file: 'chunks/manifest.js',
		file_name: (ref) => `chunks/regions/${ref}.js`,
		facade_file: (id) => (id === '/app/src/lazy.ts' ? 'chunks/lazy-x1.js' : undefined),
		graph: () => null,
		module_ids: () => [],
		page_reads: null
	};
}

describe('relocate', () => {
	test('the fn manifest takes the og.$ factories as written, `$$` and all', () => {
		const counts = new Map<string, number>();
		const out = relocate(`a;${FN}b;`, false, counts, cx({ t1: '() => `$${x}`' }));
		expect(out).toBe('a;globalThis.__og_reg_fn("t1", (() => `$${x}`));b;');
		expect(counts.get('fn manifest')).toBe(1);
	});

	test('every token in a chunk is replaced and counted', () => {
		const counts = new Map<string, number>();
		const out = relocate(`${FN}|${FN}`, false, counts, cx());
		expect(out).toBe('|');
		expect(counts.get('fn manifest')).toBe(2);
	});

	test('a browser leg leaves the server-only page-data reads alone', () => {
		const counts = new Map<string, number>();
		expect(relocate(`"${PAGE_DATA_READS_TOKEN}"`, false, counts, cx())).toBeNull();
		expect(counts.size).toBe(0);
		const shaped = { ...cx(), page_reads: { keys: () => null } };
		expect(relocate(`"${PAGE_DATA_READS_TOKEN}"`, true, counts, shaped)).toBe('"{}"');
		expect(counts.get('page data reads')).toBe(1);
	});

	test("a late server region's loader imports its chunk by its path from the chunk being finished", () => {
		const out = relocate(`const r = {...${LATE_SERVER_REGIONS_TOKEN}};`, true, new Map(), cx());
		expect(out).toBe('const r = {...{"aaaaaaaaaaaa": () => import("./regions/ref1.js")}};');
	});

	test("a server map's JSON is escaped for the quote its literal was given", () => {
		const c = cx();
		c.program.by_id.set('aaaaaaaaaaaa', 'v');
		c.program.registry.set('v', { server: true, componentPath: "/a/It's.svelte" } as never);
		const token = SERVER_MAP_TOKENS.region_name;
		for (const q of ['"', "'", '`']) {
			const out = relocate(`JSON.parse(${q}${token}${q})`, true, new Map(), c)!;
			expect(code_fn(`return ${out}`)()).toEqual({ aaaaaaaaaaaa: "It's" });
		}
	});

	test('a chunk without a token is left alone', () => {
		expect(relocate('export {}', true, new Map(), cx())).toBeNull();
	});

	test("a lazy loader's file token is its module's own chunk from the chunk being finished, or null", () => {
		const counts = new Map<string, number>();
		const code = `f(${file_token('/app/src/lazy.ts')}, ${file_token('/app/src/shared.ts')})`;
		for (const server of [false, true])
			expect(relocate(code, server, counts, cx())).toBe('f("./lazy-x1.js", null)');
		expect(counts.get('lazy loader file')).toBe(4);
	});

	test('a minifier that re-quoted a file token still has it replaced whole', () => {
		const token = file_token('/app/src/lazy.ts').split('"').join("'");
		expect(relocate(`f(${token})`, false, new Map(), cx())).toBe('f("./lazy-x1.js")');
	});

	test("only a mapped relocation's patch hands on a map (the others keep the chunk's as given)", () => {
		const table = relocations_of(false);
		const fn = relocate_table(`a;${FN}b;`, table, new Map(), cx({ t: 'x' }));
		expect(fn!.mapped).toBe(false);
		const file = relocate_table(`f(${file_token('/app/src/lazy.ts')})`, table, new Map(), cx());
		expect(file!.mapped).toBe(true);
	});
});

describe('written relocations', () => {
	test("the client leg's island deps go into the server file's slot, escaped for either quote", () => {
		const counts = new Map<string, number>();
		const deps = `{"a":"it's \\\\ ${String.fromCharCode(0x2028)}"}`;
		for (const q of ['"', "'"]) {
			const out = relocate_table(
				`export const d = ${q}${ISLAND_DEPS_INLINE_TOKEN}${q};`,
				WRITTEN_RELOCATIONS,
				counts,
				{ island_deps: deps }
			)!.s.toString();
			expect(code_fn(`${out.replace('export const d =', 'return')}`)()).toBe(deps);
		}
		expect(counts.get('island deps')).toBe(2);
	});

	test('a leg does not patch the written ones at its own end', () => {
		const code = `"${ISLAND_DEPS_INLINE_TOKEN}"`;
		expect(relocate(code, true, new Map(), cx())).toBeNull();
		expect(unpatched(true, new Map(), [{ code, moduleIds: [] }])).toEqual([]);
	});
});

describe('unpatched', () => {
	const names = (rs: { name: string }[]) => rs.map((r) => r.name);

	test('a token left in the output is said', () => {
		const left = unpatched(true, new Map(), [
			{ code: `"${PAGE_DATA_READS_TOKEN}"`, moduleIds: [] }
		]);
		expect(names(left)).toEqual(['page data reads']);
	});

	test('the fn manifest module in the output with no patch counted is said', () => {
		const chunk = { code: 'globalThis.__og_reg_fn = r;', moduleIds: [`\0${V_FN_MANIFEST}`] };
		expect(names(unpatched(false, new Map(), [chunk]))).toEqual(['fn manifest']);
		expect(unpatched(false, new Map([['fn manifest', 1]]), [chunk])).toEqual([]);
	});

	test('a browser leg is not held to a server-only token', () => {
		expect(
			unpatched(false, new Map(), [{ code: `"${PAGE_DATA_READS_TOKEN}"`, moduleIds: [] }])
		).toEqual([]);
	});
});
