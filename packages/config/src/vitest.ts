import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { ViteUserConfig } from 'vitest/config';
import { heisenbench_record } from '../../../internal/heisenbench/src/record.ts';

/** Core's test stubs: `app-<name>.ts` stands in for `$app/<name>`, `realm-<realm>.ts` for the
 *  realm module `ogygia:<realm>`, `<realm>.<id>.ts` for its entry `ogygia:<realm>/<id>`
 *  (packages/core/test/_stubs). */
const STUBS = fileURLToPath(new URL('../../core/test/_stubs/', import.meta.url));

const ENTRY_STUB = /^(server|boot|region|dev)\.(.+)$/;

const exact = (id: string): RegExp => new RegExp(`^${id.replace(/[$/.]/g, '\\$&')}$`);

/** The stubs as exact-match aliases (a realm module's id is a prefix of its entries' ids). */
export function stub_aliases(): { find: RegExp; replacement: string }[] {
	const out: { find: RegExp; replacement: string }[] = [];
	for (const file of readdirSync(STUBS)) {
		const name = file.replace(/\.ts$/, '');
		const entry = ENTRY_STUB.exec(name);
		const id = name.startsWith('app-')
			? `$app/${name.slice(4)}`
			: name.startsWith('realm-')
				? `ogygia:${name.slice(6)}`
				: entry
					? `ogygia:${entry[1]}/${entry[2]}`
					: null;
		if (id) out.push({ find: exact(id), replacement: `${STUBS}${file}` });
	}
	return out;
}

/**
 * A browser the browser projects run in: Playwright's three engines (`chromium`, `firefox`, its
 * own Firefox build, `webkit`), or `firefox-stable`: Firefox as released, through WebdriverIO and
 * geckodriver (a Playwright engine build can lag behind the release).
 */
export type TestBrowser = 'chromium' | 'firefox' | 'webkit' | 'firefox-stable';
const ENGINES: readonly TestBrowser[] = ['chromium', 'firefox', 'webkit'];

/**
 * The browsers this run's browser projects use: `OGYGIA_BROWSERS` (a comma list, as CI runs one
 * per job), else Playwright's three engines. `firefox-stable` runs on its own, since a project has
 * one provider.
 */
export function test_browsers(): TestBrowser[] {
	const asked = process.env.OGYGIA_BROWSERS?.split(',')
		.map((b) => b.trim())
		.filter(Boolean);
	if (!asked?.length) return [...ENGINES];
	for (const b of asked)
		if (b !== 'firefox-stable' && !ENGINES.includes(b as TestBrowser))
			throw new Error(`OGYGIA_BROWSERS: "${b}" is not chromium, firefox, webkit or firefox-stable`);
	if (asked.includes('firefox-stable') && asked.length > 1)
		throw new Error('OGYGIA_BROWSERS: firefox-stable runs on its own (its own WebDriver provider)');
	return asked as TestBrowser[];
}

/**
 * A browser project's `provider`, `instances` and `headless` for this run (see
 * {@link test_browsers}): Playwright for its engines, WebdriverIO for the released Firefox.
 */
export async function browser_runs(): Promise<{
	provider: NonNullable<NonNullable<ViteUserConfig['test']>['browser']>['provider'];
	instances: { browser: string }[];
	headless: boolean;
}> {
	const browsers = test_browsers();
	if (browsers[0] === 'firefox-stable') {
		const binary = firefox_binary();
		console.log(
			binary === null
				? '[browsers] Firefox: none installed, webdriverio fetches a managed one'
				: `[browsers] Firefox ${firefox_version(binary)} at ${binary}`
		);
		const { webdriverio } = await import('@vitest/browser-webdriverio');
		return {
			provider: webdriverio(
				binary === null
					? {}
					: { capabilities: { browserName: 'firefox', 'moz:firefoxOptions': { binary } } }
			),
			instances: [{ browser: 'firefox' }],
			headless: true
		};
	}
	const { playwright } = await import('@vitest/browser-playwright');
	return {
		provider: playwright(),
		instances: browsers.map((browser) => ({ browser })),
		headless: true
	};
}

/**
 * The installed Firefox a `firefox-stable` run uses: `OGYGIA_FIREFOX` (a path), else the platform's
 * own install place, else null (webdriverio fetches a managed Firefox and its geckodriver).
 */
export function firefox_binary(): string | null {
	const given = process.env.OGYGIA_FIREFOX;
	if (given) {
		if (!existsSync(given)) throw new Error(`OGYGIA_FIREFOX: no file at ${given}`);
		return given;
	}
	const places =
		process.platform === 'darwin'
			? ['/Applications/Firefox.app/Contents/MacOS/firefox']
			: process.platform === 'win32'
				? [
						'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
						'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
					]
				: [on_path('firefox')];
	for (const p of places) if (p && existsSync(p)) return p;
	return null;
}

/** The version a Firefox binary says it is (`Mozilla Firefox 159.0.1`), or `unknown`. */
function firefox_version(binary: string): string {
	try {
		return execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 20_000 }).trim();
	} catch {
		return 'unknown';
	}
}

/** A command's path on PATH, or null. */
function on_path(name: string): string | null {
	try {
		return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null;
	} catch {
		return null;
	}
}

/** Whether this run drives the browser through Playwright (its network routes). */
export const playwright_run = (): boolean => test_browsers()[0] !== 'firefox-stable';

/**
 * The unit-test setup every ogygia plugin package shares: node environment, the Svelte plugin (core's
 * source reaches `.svelte` files), and core's stubs for Kit's `$app/*` and ogygia's virtual modules,
 * so a plugin's tests run against core's real source without a Kit app or the Vite plugin.
 */
export function pluginTests(): ViteUserConfig {
	return {
		// heisenbench_record(): nothing, unless the measurement-source gate records the tests' inputs
		plugins: [svelte(), ...heisenbench_record()],
		resolve: { alias: stub_aliases() },
		test: { include: ['test/**/*.test.ts'], environment: 'node' }
	};
}
