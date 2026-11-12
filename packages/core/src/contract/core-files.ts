/**
 * Core's own files, as the compiler addresses them: head-on paths into the built package (never
 * `this.resolve`, which is not portable off a synthetic importer). Core knows where its files are;
 * the compiler, a separate package, asks here.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Core's package root (`src/contract/` and `dist/contract/` are both two levels down). A NATIVE
 *  path (backslashes on Windows): for the file system, never to compare against a module id. */
export const CORE_ROOT: string = fileURLToPath(new URL('../..', import.meta.url));

/** A file of core's build, by its path inside `dist/`. */
function built(file: string): string {
	return path.join(CORE_ROOT, 'dist', file);
}

/** Core's version, as installed (the runtime discloses it: runtime/disclose-version.ts). */
export const OGYGIA_VERSION: string = (
	JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

/** Windows separators → posix. */
const WIN_SEP_RE = /\\/g;

/** A native path as Vite writes module ids: symlinks resolved (pnpm), forward slashes (Windows). */
export function real_posix(p: string): string {
	try {
		p = fs.realpathSync(p);
	} catch {
		// ok: kept as given; a missing path never matches an id
	}
	return p.replace(WIN_SEP_RE, '/');
}

/** A native directory as the PREFIX of the module ids inside it: `real_posix` + one trailing `/`, so a
 *  `startsWith` never matches a sibling (`ogygia-x/`) and holds on Windows, where the native path has
 *  backslashes and Vite's ids do not. */
export function id_dir(p: string): string {
	const posix = real_posix(p);
	return posix.endsWith('/') ? posix : `${posix}/`;
}

/** THE own-package test: every module id inside core starts with this. Every check of "is this id
 *  ogygia's own file" compares against it, never against CORE_ROOT. */
export const CORE_ROOT_ID: string = id_dir(CORE_ROOT);

/** The two ogygia self-imports the transform injects into hosts / generated island modules. */
export const OGYGIA_INJECTED_IMPORTS: Set<string> = new Set([
	'ogygia/internal',
	'ogygia/internal/server'
]);

/**
 * DIRECT paths to ogygia's OWN injected runtime entries. The transform writes `ogygia/internal` /
 * `ogygia/internal/server` into a host or a generated island module, and a host in a monorepo
 * sub-package that doesn't depend on ogygia must still resolve them.
 *
 * A published install ships only `dist` → `dist/internal.js`. ogygia's OWN source checkout has `src/`,
 * and the rest of the app resolves ogygia through the `svelte` export condition (→ `src`), so there we
 * point at `src/internal.ts` too — same module, no Region/brand identity fork.
 */
const OG_HAS_SRC = fs.existsSync(path.join(CORE_ROOT, 'src/internal.ts'));

/** ogygia's `Region.svelte` — either copy, as the POSIX id Vite hands the transform hook (a workspace
 *  can load the src one and the dist one both): its LateIsland import is the awaiting one where the
 *  app runs Svelte's async mode (late-island.ts). */
export const OGYGIA_REGION_MODULES: ReadonlySet<string> = new Set([
	`${CORE_ROOT_ID}src/Region.svelte`,
	`${CORE_ROOT_ID}dist/Region.svelte`
]);
export const OGYGIA_INJECTED_FILES: Record<string, string> = OG_HAS_SRC
	? {
			'ogygia/internal': path.join(CORE_ROOT, 'src/internal.ts'),
			'ogygia/internal/server': path.join(CORE_ROOT, 'src/internal-server.ts')
		}
	: {
			'ogygia/internal': built('internal.js'),
			'ogygia/internal/server': built('internal-server.js')
		};

/** Client-side shims aliased for island modules (Kit's client runtime is absent under csr=false). */
export const APP_SHIMS: { '$app/state': string; '$app/stores': string; '$app/navigation': string } =
	{
		'$app/state': built('shims/app-state.svelte.js'),
		'$app/stores': built('shims/app-stores.js'),
		'$app/navigation': built('shims/app-navigation.js')
	};

/** On-disk stub for `ogygia:region/client-binding-stub` (csr=false client hosts): a lake placeholder
 *  and a portable binding stub both render nothing on the client. */
export const CLIENT_BINDING_STUB_FILE: string = built('ClientBindingStub.svelte');

// Kit's OWN client remote primitives (query/command/form/live), with the two router-coupled modules
// they pull in (`client.js`, `state.svelte.js`) scope-aliased to tiny stubs, so the router graph
// never loads.
export const STUB_CLIENT: string = built('shims/kit-remote/client-stub.js');
export const STUB_STATE: string = built('shims/kit-remote/state-stub.js');
export const STUB_PATHS: string = built('shims/kit-remote/paths-internal-stub.js');

/** The prebuilt runtime dir the runtime chunk bundles (for `generateRuntimeEntrySource`); its
 *  parent is the built package the virtual table's server modules point into. */
export const RUNTIME_DIR: string = built('runtime');

/** Core's inputs to the runtime chunk besides RUNTIME_DIR's modules, in hash order. */
export const RUNTIME_INPUTS: readonly string[] = [
	built('live-transport.js'),
	built('context-bridge.js'),
	built('keep-fallback-marker.js'),
	built('shims/page-store.svelte.js'),
	built('shims/kit-remote/client-stub.js'),
	built('nested.js')
];
