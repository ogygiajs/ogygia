// The analysis table (src/compiler/link/analyses.ts) stays true: each entry's function is where it
// says, and each has an oracle (a file marked `// oracle: <name>`) or a gap naming the issue for one,
// never both. A marker for an analysis the table does not list fails, so an oracle cannot drift
// away from its analysis. Oracles may live anywhere in the repo's packages or internal tools.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANALYSES } from '../src/compiler/link/analyses.ts';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = fileURLToPath(new URL('../src/compiler/', import.meta.url));
const MARKER_G = /^\/\/ oracle: (\S+)$/gm;
const SOURCE_EXT = /\.(?:ts|js|svelte)$/;
const SKIP = new Set(['node_modules', 'dist', '.svelte-kit', 'build']);

/** Every `// oracle: <name>` line in the repo's packages and internal tools: name → files. */
function oracle_markers(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (SOURCE_EXT.test(entry.name)) {
				const text = readFileSync(full, 'utf8');
				if (!text.includes('// oracle: ')) continue;
				for (const m of text.matchAll(MARKER_G)) {
					const files = found.get(m[1]) ?? [];
					files.push(path.relative(REPO, full));
					found.set(m[1], files);
				}
			}
		}
	};
	for (const top of ['packages', 'internal']) {
		for (const pkg of readdirSync(path.join(REPO, top), { withFileTypes: true })) {
			if (!pkg.isDirectory()) continue;
			for (const sub of ['src', 'test']) {
				const dir = path.join(REPO, top, pkg.name, sub);
				if (existsSync(dir)) walk(dir);
			}
		}
	}
	return found;
}

describe('the analysis table', () => {
	const markers = oracle_markers();

	it('names each analysis once', () => {
		const names = ANALYSES.map((a) => a.name);
		expect(names).toEqual([...new Set(names)]);
	});

	it.each(ANALYSES.map((a) => [a.name, a] as const))(
		'%s: its function is where the table says',
		(_name, a) => {
			const file = path.join(SRC, a.where.file);
			expect(existsSync(file), a.where.file).toBe(true);
			expect(readFileSync(file, 'utf8')).toContain(a.where.symbol);
		}
	);

	it.each(ANALYSES.map((a) => [a.name, a] as const))(
		'%s: has an oracle, or a gap naming the issue for one, never both',
		(name, a) => {
			const oracles = markers.get(name) ?? [];
			const why =
				a.gap === null
					? `${name}: no file is marked \`// oracle: ${name}\`, and no gap names an issue`
					: `${name}: ${oracles.join(', ')} judges it, so its gap is stale`;
			expect(oracles.length > 0, why).toBe(a.gap === null);
		}
	);

	it('every oracle marker names an analysis in the table', () => {
		const known = new Set<string>(ANALYSES.map((a) => a.name));
		const stray = [...markers].filter(([name]) => !known.has(name));
		expect(stray).toEqual([]);
	});
});
