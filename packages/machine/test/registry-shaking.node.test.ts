// A bundle pays only for the registry form it uses: the browser boot holds owned entries with
// `registry()` and never the keyed form (#461's boot growth).
import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const INDEX = fileURLToPath(new URL('../src/index.ts', import.meta.url));

async function bundle(entry: string): Promise<string> {
	const file = join(mkdtempSync(join(tmpdir(), 'og-registry-')), 'entry.mjs');
	writeFileSync(file, entry);
	const b = await rolldown({ input: file, logLevel: 'silent' });
	const { output } = await b.generate({ format: 'esm', minify: true });
	await b.close();
	return output.map((o) => ('code' in o ? o.code : '')).join('\n');
}

it('a bundle that uses registry() alone carries no keyed registry', async () => {
	const code = await bundle(
		`import { registry } from ${JSON.stringify(INDEX)};\nexport const live = registry();\n`
	);
	// (class fields keep their names through minifying: Held's `_entries`, Keyed's `_held`)
	expect(code).toContain('_entries');
	expect(code).not.toContain('_held');
});
