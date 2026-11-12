// `@ogygia/core/internal/instruments` is read by node-side tools too: devtools' Vite plugin reaches it
// through @ogygia/insights while an app's vite.config.ts loads, in plain Node. Nothing it imports may
// name an `ogygia:` virtual module, which only Vite's pipeline resolves (the docs site's config load
// failed with ERR_UNSUPPORTED_ESM_URL_SCHEME).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const INSTRUMENTS = fileURLToPath(new URL('../src/internal-instruments.ts', import.meta.url));

it('the instruments entry loads in plain Node, with no ogygia: virtual module on its path', () => {
	const run = () =>
		execFileSync(
			process.execPath,
			['--input-type=module', '-e', `await import(${JSON.stringify(INSTRUMENTS)});`],
			{ encoding: 'utf8', stdio: 'pipe' }
		);
	expect(run).not.toThrow();
});
