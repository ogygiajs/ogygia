// VALUES KNOWN ONLY AT THE END OF A LEG (link/relocations.ts): every token a finished chunk carries is
// replaced, each patch is counted on the leg, and a leg whose output still holds a token, or holds
// the module that writes one with no patch counted, is said (`relocation_unpatched`).
import { describe, expect, test } from 'vitest';
import { Program } from '../src/compiler/program.ts';
import { V_FN_MANIFEST } from '../src/compiler/ids.ts';
import {
	LATE_SERVER_REGIONS_TOKEN,
	PAGE_DATA_READS_TOKEN,
	SERVER_MAP_TOKENS
} from '../src/compiler/link/server-manifest.ts';
import { relocate, unpatched, type RelocateCx } from '../src/compiler/link/relocations.ts';

const FN = '/*__OGYGIA_FN_MANIFEST__*/';

function cx(hoists: Record<string, string> = {}): RelocateCx {
	return {
		program: new Program({ forms: true, router: true }),
		dollar_hoists: new Map(Object.entries(hoists)),
		public_url: (iid) => `/_app/${iid}.js`,
		late_server_regions: new Map([['aaaaaaaaaaaa', 'ref1']]),
		chunk_file: 'chunks/manifest.js',
		file_name: (ref) => `chunks/regions/${ref}.js`,
		graph: () => null,
		module_ids: () => []
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
		expect(relocate(`"${PAGE_DATA_READS_TOKEN}"`, true, counts, cx())).toBe('"{}"');
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
			expect(new Function(`return ${out}`)()).toEqual({ aaaaaaaaaaaa: "It's" });
		}
	});

	test('a chunk without a token is left alone', () => {
		expect(relocate('export {}', true, new Map(), cx())).toBeNull();
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
