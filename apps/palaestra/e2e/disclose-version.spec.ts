// WHICH OGYGIA A PAGE RUNS: `window.__ogygia.v` holds the installed version, as `window.__svelte.v`
// holds Svelte's — on a csr=false page (the ogygia runtime discloses it at boot) AND on a csr=true page
// (Kit runs it and the runtime never boots: the plugin's line in Kit's app entry discloses it).
//
// Usage: pnpm exec playwright test disclose-version
import { readFileSync } from 'node:fs';
import { test, check } from '@ogygia/tooling/e2e';

const VERSION = (
	JSON.parse(
		readFileSync(new URL('../../../packages/core/package.json', import.meta.url), 'utf8')
	) as { version: string }
).version;

for (const [path, csr] of [
	['/', false],
	['/kit', true]
] as const) {
	test(`a csr=${csr} page discloses the ogygia version (${path})`, async ({ page }) => {
		await page.goto(path, { waitUntil: 'load' });
		const seen = await page.evaluate(() => ({
			v: [...((window as { __ogygia?: { v?: Set<string> } }).__ogygia?.v ?? [])],
			kit: Object.keys(window).some((k) => k.startsWith('__sveltekit_'))
		}));
		check(`the page is csr=${csr}`, seen.kit === csr);
		check(
			`window.__ogygia.v is [${VERSION}]`,
			JSON.stringify(seen.v) === JSON.stringify([VERSION]),
			JSON.stringify(seen.v)
		);
	});
}
