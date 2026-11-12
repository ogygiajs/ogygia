/**
 * Loaded before a bench run (`node --import internal/heisenbench/src/preload.ts …`; the bench repo's
 * runner adds it whenever this file exists). Outside Vite, the specifiers only the plugin or Kit
 * serve (`ogygia:*`, `$app/*`) resolve to the unit-test stubs in packages/core/test/_stubs,
 * the same ones packages/core/vitest.config.ts aliases: `$app/env` -> app-env.ts,
 * `ogygia:server/sign` -> server.sign.ts. And the hydrate core's `svelte` resolves to a stand-in
 * for Svelte's client `hydrate` (svelte-hydrate.ts, below). And a bench page's island files, which a
 * browser fetches from the page's origin (runtime/code-origins.ts refuses any other), are the
 * stand-in island module, one instance per file: `<ISLAND_FILES><name>` -> island-module.ts?entry=<name>.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

const STUBS = new URL('../../../packages/core/test/_stubs/', import.meta.url);
/** Where the bench page's island files are (packages/core/bench/hydration-page.ts `island_file`). */
const ISLAND_FILES = 'https://shop.example.test/_app/ogygia/';
const APP = '$app/';
/** a realm module (`ogygia:server`) -> realm-server.ts; an entry by its own id -> <realm>.<id>.ts */
const REALM_RE = /^ogygia:(server|boot|region|dev)(?:\/(.+))?$/;

function stub_name(specifier: string): string | null {
	if (specifier.startsWith(APP)) return `app-${specifier.slice(APP.length)}`;
	const realm = REALM_RE.exec(specifier);
	if (realm) return realm[2] ? `${realm[1]}.${realm[2]}` : `realm-${realm[1]}`;
	return null;
}

/** The hydrate core's `svelte` (its `hydrate` / `unmount`): Node resolves Svelte's server build, where
 *  they throw, so the hydration benches get the stand-in (packages/core/test/_stubs/svelte-hydrate.ts).
 *  Every other module keeps the real `svelte`. */
const HYDRATE_CORE = '/packages/core/src/runtime/hydrate-core.ts';

function hydrate_core_import(context: { parentURL?: string }): boolean {
	const parent = context.parentURL;
	if (!parent) return false;
	const q = parent.indexOf('?');
	return (q === -1 ? parent : parent.slice(0, q)).endsWith(HYDRATE_CORE);
}

registerHooks({
	resolve(specifier, context, next) {
		if (specifier === 'svelte' && hydrate_core_import(context))
			return { url: new URL('svelte-hydrate.ts', STUBS).href, shortCircuit: true };
		if (specifier.startsWith(ISLAND_FILES)) {
			const file = new URL('island-module.ts', STUBS);
			file.searchParams.set('entry', specifier.slice(ISLAND_FILES.length));
			return { url: file.href, shortCircuit: true };
		}
		const name = stub_name(specifier);
		if (name === null) return next(specifier, context);
		const file = new URL(`${name}.ts`, STUBS);
		if (!existsSync(file))
			throw new Error(`heisenbench preload: no stub for ${specifier} (expected ${file.pathname})`);
		return { url: file.href, shortCircuit: true };
	}
});
