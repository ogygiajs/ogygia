/** The page's data, made the same on every run (a seeded generator, no files that change). */

export interface Row {
	id: number;
	name: string;
	region: string;
	amount: number;
	currency: string;
	placed: string;
	status: 'paid' | 'open' | 'late' | 'void';
	items: number;
}

function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FIRST = ['Ada', 'Bea', 'Cy', 'Dov', 'Eli', 'Fen', 'Gus', 'Hal', 'Ira', 'Jo', 'Kit', 'Lu'];
const LAST = ['Ames', 'Brook', 'Cole', 'Dunn', 'Eads', 'Ford', 'Gray', 'Hart', 'Ives', 'Judd'];
const REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Islands'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'INR'];
const STATUSES: Row['status'][] = ['paid', 'paid', 'paid', 'open', 'late', 'void'];

export function make_rows(count: number, seed: number): Row[] {
	const r = random(seed);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
	const start = Date.UTC(2026, 0, 1);
	return Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		name: pick(FIRST) + ' ' + pick(LAST),
		region: pick(REGIONS),
		amount: Math.round(r() * 500_000) / 100,
		currency: pick(CURRENCIES),
		placed: new Date(start + Math.floor(r() * 300) * 86_400_000).toISOString(),
		status: pick(STATUSES),
		items: 1 + Math.floor(r() * 12)
	}));
}

const SHAPES = [
	(n: string, r: () => number) =>
		`export function ${n}(input: readonly number[], limit = ${Math.floor(r() * 100)}): number[] {\n` +
		`\tconst out: number[] = [];\n\tfor (const value of input) {\n\t\tif (value > limit) out.push(value * 2); // doubled past the limit\n\t\telse out.push(value);\n\t}\n\treturn out;\n}\n`,
	(n: string, r: () => number) =>
		`export interface ${n[0]!.toUpperCase() + n.slice(1)}Options {\n\treadonly name: string;\n\treadonly retries?: number;\n\treadonly mode: 'fast' | 'safe' | ${Math.floor(r() * 9)};\n}\n`,
	(n: string, r: () => number) =>
		`export async function ${n}(url: string, signal?: AbortSignal): Promise<string> {\n` +
		`\tconst res = await fetch(url + '?v=${Math.floor(r() * 1e6)}', { signal });\n\tif (!res.ok) throw new Error(\`answered \${res.status}\`);\n\treturn res.text();\n}\n`,
	(n: string) =>
		`export class ${n[0]!.toUpperCase() + n.slice(1)} {\n\t#items = new Map<string, number>();\n\tget size(): number {\n\t\treturn this.#items.size;\n\t}\n\tadd(key: string, by = 1): this {\n\t\tthis.#items.set(key, (this.#items.get(key) ?? 0) + by);\n\t\treturn this;\n\t}\n}\n`
];

/** A TypeScript source of about `lines` lines. */
export function make_source(lines: number, seed: number): string {
	const r = random(seed);
	let out = `/** generated (seed ${seed}) */\nimport { scope, STALE } from '@ogygia/machine';\n\n`;
	let i = 0;
	while (out.split('\n').length < lines) {
		const shape = SHAPES[Math.floor(r() * SHAPES.length)]!;
		out += shape('step' + i++, r) + '\n';
	}
	return out;
}
