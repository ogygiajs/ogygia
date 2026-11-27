/**
 * THE KIT MODULE PATCHES: every SvelteKit module whose text the compiler changes, in one table. Each
 * row names the module (by its id), the text of Kit's it relies on, and what it makes of it. Kit's
 * generated text is Kit's private code: `test/canary/kit-build.test.ts` asks a real Kit app for each
 * row's module and fails, naming the row, when its text moves (internal/notes/INVARIANTS.md
 * KIT-PUBLIC-ENV).
 *
 * @packageDocumentation
 */
import { dedent, OGYGIA_VERSION } from '@ogygia/core/contract';
import { warn } from './messages.ts';

/** One patch of a Kit module, applied to the browser's copy only. */
export interface KitPatch {
	/** what the row is for, as its canary names it */
	readonly name: string;
	/** the ids of the Kit modules it patches */
	readonly id: RegExp;
	/** the Kit majors that generate the module, and the serve mode it is generated for (absent:
	 *  every one); the canary asks each of them for it */
	readonly kits: readonly number[];
	readonly mode?: 'dev' | 'build';
	/** the module's text, patched; `null`: left as Kit wrote it */
	readonly patch: (code: string, id: string) => string | null;
}

const KIT_PAGE_THREAD = `\n${dedent`
	import { page as __og_kit_page, navigating as __og_kit_nav } from '$app/state';
	import * as __og_kit_navigation from '$app/navigation';
	globalThis[Symbol.for('ogygia.kit-page')] = { page: __og_kit_page, navigating: __og_kit_nav, navigation: __og_kit_navigation };
`}\n`;
const KIT_DISCLOSE_VERSION = `((globalThis.__ogygia ??= {}).v ??= new Set()).add(${JSON.stringify(OGYGIA_VERSION)});\n`;

/** Kit 3's browser `$app/env/public`, as Kit generates it under its out dir (dev and build). */
export const KIT_PUBLIC_ENV_CLIENT_RE: RegExp =
	/\/generated\/(?:build|dev)\/env\/public\/client\.js$/;
const KIT_ENV_READER = `import { kit_env as __og_kit_env } from 'ogygia:boot/kit-env';\n`;
const DYNAMIC_READ_RE = /=\s*env\./;

function public_env_patch(read: string, fallback: string): KitPatch['patch'] {
	return (code, id) => {
		if (!DYNAMIC_READ_RE.test(code)) return null;
		if (!code.includes(read)) {
			warn('kit_env_unpatched', { file: id });
			return null;
		}
		return KIT_ENV_READER + code.replace(read, () => fallback);
	};
}

/** The Kit module patches, in the order a module meets them. */
export const KIT_PATCHES: readonly KitPatch[] = [
	{
		name: "Kit's client app: the kit-page thread",
		id: /\/generated\/(?:build\/|dev\/)?client(-optimized)?\/app\.js$/,
		kits: [2, 3],
		patch: (code) => code + KIT_PAGE_THREAD + KIT_DISCLOSE_VERSION
	},
	{
		name: "Kit 3's dev $app/env/public: the env of a page Kit never started",
		id: /\/generated\/dev\/env\/public\/client\.js$/,
		kits: [3],
		mode: 'dev',
		patch: public_env_patch(
			'const { env } = globalThis.__sveltekit_dev;',
			'const { env } = globalThis.__sveltekit_dev ?? { env: __og_kit_env() };'
		)
	},
	{
		name: "Kit 3's built $app/env/public: the env of a page Kit never started",
		id: /\/generated\/build\/env\/public\/client\.js$/,
		kits: [3],
		mode: 'build',
		patch: public_env_patch(
			'const env = payload.env;',
			'const env = payload.env ?? __og_kit_env();'
		)
	}
];

/** `code` with every patch whose module `id` is, for the browser; `code` itself when none applies. */
export function patch_kit_module(code: string, id: string): string {
	let out = code;
	for (const row of KIT_PATCHES) if (row.id.test(id)) out = row.patch(out, id) ?? out;
	return out;
}

/**
 * `ogygia:server/kit-env` for the app's Kit major: Kit 3's `rendered_env`, the object Kit puts in its
 * boot payload as `env` on a csr=true page (public variables only, set again as Kit's server starts).
 * Any other Kit: `null`.
 */
export function kit_public_env_module(major: number | null): string {
	if (major === null || major < 3) return 'export function kit_public_env() { return null; }\n';
	return dedent`
		import { rendered_env } from '<sveltekit:generated>/env/config.js';
		export function kit_public_env() { return rendered_env; }
	`;
}
