// Build the testing engine as one script a test injects before the page loads (dist/engine.js):
// devtools' testing-script.ts with every import bundled in, so the page needs nothing of devtools
// to answer `window.__ogygia_testing`. Runs after tsdown in every build.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const entry = fileURLToPath(
	new URL('../node_modules/@ogygia/devtools/src/devtools/testing-script.ts', import.meta.url)
);
const out = fileURLToPath(new URL('../dist/engine.js', import.meta.url));

const result = await build({
	input: entry,
	platform: 'browser',
	treeshake: true,
	write: false,
	// (no file of its own: the dock files the ledger leaves out by this URL are not on a test's page)
	transform: { define: { 'import.meta.url': '""' } },
	// (the banner runs before the bundled modules: the engine charges its own evaluation from it)
	output: {
		format: 'iife',
		codeSplitting: false,
		minify: true,
		banner: 'var __og_engine_t0=performance.now();'
	}
});
const [chunk] = result.output;
if (result.output.length !== 1 || chunk.type !== 'chunk')
	throw new Error(`the engine script must be one file, got ${result.output.length}`);
fs.mkdirSync(fileURLToPath(new URL('../dist/', import.meta.url)), { recursive: true });
fs.writeFileSync(out, chunk.code);
console.log(`wrote dist/engine.js (${chunk.code.length} bytes)`);
