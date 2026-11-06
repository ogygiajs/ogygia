// WHICH OGYGIA A PAGE RUNS: `window.__ogygia.v` holds the installed version, as `window.__svelte.v`
// holds Svelte's — on a csr=false page (the ogygia runtime discloses it at boot) AND on a csr=true page
// (the plugin's line in Kit's app entry discloses it). A csr=true page whose deferred regions boot the
// runtime too lists the version once: both add it to the same Set.
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
	['/kit', true],
	// csr=true with deferred regions: the runtime boots here as well
	['/lake-kit/kit', true]
] as const) {
	test(`a csr=${csr} page discloses the ogygia version (${path})`, async ({ page }) => {
		await page.goto(path, { waitUntil: 'load' });
		// (a csr=true page discloses it as Kit's app entry evaluates: Kit imports it, so it can land
		// after `load`)
		await page
			.waitForFunction(
				() => ((window as { __ogygia?: { v?: Set<string> } }).__ogygia?.v?.size ?? 0) > 0,
				null,
				{ timeout: 10_000 }
			)
			.catch(() => {});
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
