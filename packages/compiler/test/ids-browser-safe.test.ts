// `@ogygia/compiler/ids` loads in the browser (the devtools profiler reads it in the page), so its
// static import closure stays inside the compiler and import-free: reaching the compiler's messages
// pulled core's node-only contract (node:fs, `new URL` of core's root) into a client bundle.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/compiler/', import.meta.url));
const IMPORT_RE = /^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/gm;

function closure(file: string, seen = new Set<string>()): Set<string> {
	if (seen.has(file)) return seen;
	seen.add(file);
	for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
		if (!spec.startsWith('.')) {
			seen.add(spec);
			continue;
		}
		closure(path.resolve(path.dirname(file), spec), seen);
	}
	return seen;
}

describe('@ogygia/compiler/ids', () => {
	it('reaches only its own import-free modules, never core or the compiler’s messages', () => {
		const reached = [...closure(path.join(SRC, 'ids.ts'))].map((f) => path.relative(SRC, f));
		expect(reached.sort()).toEqual(['ids.ts', 'virtual/specifier.ts']);
	});
});
