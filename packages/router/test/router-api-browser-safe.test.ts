import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm;

/** Every module `entry` loads at run time (type-only imports do not load), by its specifier. */
function runtime_imports(entry: string): { local: string[]; bare: string[] } {
	const local = new Set<string>();
	const bare = new Set<string>();
	const walk = (file: string) => {
		if (local.has(file)) return;
		local.add(file);
		for (const m of readFileSync(join(src, file), 'utf8').matchAll(VALUE_IMPORT)) {
			if (m[1].startsWith('./')) walk(m[1].slice(2));
			else bare.add(m[1]);
		}
	};
	walk(entry);
	return { local: [...local].sort(), bare: [...bare].sort() };
}

describe('@ogygia/router/api', () => {
	it('loads nothing but the path grammar, so an island can import it in the browser', () => {
		expect(runtime_imports('client-api.ts')).toEqual({
			local: ['client-api.ts', 'match.ts'],
			bare: []
		});
	});
});
