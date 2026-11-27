/**
 * THE KIT MODULE PATCHES: every SvelteKit module whose text the compiler changes, in one table. Each
 * row names the module (by its id), the text of Kit's it relies on, and what it makes of it. Kit's
 * generated text is Kit's private code: `test/canary/kit-build.test.ts` asks a real Kit app for each
 * row's module and fails, naming the row, when its text moves (internal/notes/INVARIANTS.md
 * KIT-PUBLIC-ENV).
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { dedent, OGYGIA_VERSION } from '@ogygia/core/contract';
import type { Fs } from './fs.ts';
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

function public_env_patch(read: string, fallback: string, inert: string | null): KitPatch['patch'] {
	return (code, id) => {
		const dynamic = DYNAMIC_READ_RE.test(code);
		const to = dynamic ? fallback : inert;
		if (to === null) return null;
		if (!code.includes(read)) {
			warn('kit_env_unpatched', { file: id });
			return null;
		}
		return (dynamic ? KIT_ENV_READER : '') + code.replace(read, () => to);
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
			'const { env } = globalThis.__sveltekit_dev ?? { env: __og_kit_env() };',
			'const { env } = globalThis.__sveltekit_dev ?? { env: {} };'
		)
	},
	{
		name: "Kit 3's built $app/env/public: the env of a page Kit never started",
		id: /\/generated\/build\/env\/public\/client\.js$/,
		kits: [3],
		mode: 'build',
		patch: public_env_patch(
			'const env = payload.env;',
			'const env = payload.env ?? __og_kit_env();',
			null
		)
	}
];

/** `code` with every patch whose module `id` is, for the browser; `code` itself when none applies. */
export function patch_kit_module(code: string, id: string): string {
	let out = code;
	for (const row of KIT_PATCHES) if (row.id.test(id)) out = row.patch(out, id) ?? out;
	return out;
}

/** What names an app for its env channel: its package name (else its root's folder name), its base
 *  and its app dir. */
export interface KitEnvApp {
	readonly root: string;
	readonly base: string;
	readonly app_dir: string;
	readonly fs: Fs;
}

/**
 * The build's identity on Kit's env channel: the server writes it beside the env, and the browser's
 * reader reads the env only when the channel bears its own. Both legs of one app make the same one
 * from the same facts (the app's name, base and app dir); a federated peer is another app, so its
 * reader never takes the host's env as its own. It holds no path and no time, so a build made again
 * is byte-identical.
 */
export function kit_env_build(app: KitEnvApp): string {
	let name = '';
	const pkg = app.fs.read(path.join(app.root, 'package.json'));
	if (pkg !== null) {
		try {
			const read = (JSON.parse(pkg) as { name?: unknown }).name;
			if (typeof read === 'string') name = read;
			// oxlint-disable-next-line ogygia/no-silent-failures -- a package.json that does not parse names no package: the root's folder names the app
		} catch {}
	}
	return createHash('sha256')
		.update([name || path.basename(app.root), app.base, app.app_dir].join('\0'))
		.digest('hex')
		.slice(0, 12);
}

/**
 * `ogygia:server/kit-env` for the app's Kit major: Kit 3's `rendered_env`, the object Kit puts in its
 * boot payload as `env` on a csr=true page (public variables only, set again as Kit's server starts),
 * and the build's identity (`kit_env_build`). Any other Kit: a `null` env.
 */
export function kit_public_env_module(major: number | null, build: string): string {
	const id = `export const kit_env_build = ${JSON.stringify(build)};\n`;
	if (major === null || major < 3)
		return `${id}export function kit_public_env() { return null; }\n`;
	return `${id}${dedent`
		import { rendered_env } from '<sveltekit:generated>/env/config.js';
		export function kit_public_env() { return rendered_env; }
	`}`;
}

/** `ogygia:boot/kit-env`: the runtime's reader at `file`, bound to the build's identity. */
export function kit_env_reader_module(file: string, build: string): string {
	return dedent`
		import { kit_env as read } from ${JSON.stringify(file)};
		export const kit_env = () => read(${JSON.stringify(build)});
	`;
}
