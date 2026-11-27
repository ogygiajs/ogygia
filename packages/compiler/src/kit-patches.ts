/**
 * THE KIT MODULE PATCHES: every SvelteKit module whose text the compiler changes, in one table. Each
 * row names the module (by its id), the text of Kit's it relies on, and what it makes of it. Kit's
 * generated text is Kit's private code: `test/canary/kit-build.test.ts` asks a real Kit app for each
 * row's module and fails, naming the row, when its text moves (internal/notes/INVARIANTS.md
 * KIT-PUBLIC-ENV).
 *
 * @packageDocumentation
 */
import { createHash, type Hash } from 'node:crypto';
import path from 'node:path';
import { dedent, OGYGIA_VERSION } from '@ogygia/core/contract';
import { dev_bridge_call } from './dev-bridge.ts';
import type { Fs, FsEntry } from './fs.ts';
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

const kit_public_env_re = (mode: string) =>
	new RegExp(`/generated/${mode}/env/public/client\\.js$`);
/** Kit 3's browser `$app/env/public`, as Kit generates it under its out dir (dev and build). */
export const KIT_PUBLIC_ENV_CLIENT_RE: RegExp = kit_public_env_re('(?:build|dev)');
const KIT_ENV_READER = `import { kit_env as __og_kit_env } from 'ogygia:boot/kit-env';\n`;
const DYNAMIC_READ_RE = /=\s*env\./;
const STRING_LITERAL_G = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const ENV_REFERENCE_RE = /(?<![\w$.])env(?![\w$]|\s*:)/;

function public_env_patch(read: string, fallback: string, inert: string | null): KitPatch['patch'] {
	return (code, id) => {
		if (code.trim() === '') return null;
		const bare = code.replace(STRING_LITERAL_G, '""');
		const dynamic = DYNAMIC_READ_RE.test(bare);
		const anchored = code.includes(read);
		if (!dynamic && anchored && ENV_REFERENCE_RE.test(bare.replace(read, ''))) {
			warn('kit_env_unpatched', { file: id });
			return null;
		}
		const to = dynamic ? fallback : inert;
		if (to === null) return null;
		if (!anchored) {
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
		id: kit_public_env_re('dev'),
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
		id: kit_public_env_re('build'),
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

/** What names an app for its env channel: its package.json, its base, its app dir and its source
 *  (`src`, and Kit's routes dir where it is not under `src`); and where Kit wrote its env config
 *  (`kit.outDir`, for the serve mode). */
export interface KitEnvApp {
	readonly root: string;
	readonly base: string;
	readonly app_dir: string;
	readonly routes_dir: string;
	readonly out_dir: string;
	readonly mode: 'dev' | 'build';
	readonly fs: Fs;
}

const DYNAMIC_PUBLIC_SET_RE = /\brendered_env\.[\w$]+\s*=/;

/** True when the env config Kit generated for the app's mode (`<outDir>/generated/<mode>/env/config.js`)
 *  sets a dynamic public variable (`public: true, static: false`), the only kind Kit's payload, and
 *  so the channel, carries; true too when it cannot be read. */
export function kit_env_dynamic(app: Pick<KitEnvApp, 'out_dir' | 'mode' | 'fs'>): boolean {
	const config = app.fs.read(path.join(app.out_dir, 'generated', app.mode, 'env', 'config.js'));
	return config === null || DYNAMIC_PUBLIC_SET_RE.test(config);
}

const by_name = (a: FsEntry, b: FsEntry) => Number(a.name > b.name) - Number(a.name < b.name);

function hash_tree(files: Fs, dir: string, rel: string, into: Hash): void {
	const entries = files.list(dir);
	if (entries === null) return;
	for (const e of [...entries].sort(by_name)) {
		if (e.name.startsWith('.')) continue;
		const at = `${rel}/${e.name}`;
		if (e.kind === 'dir') hash_tree(files, path.join(dir, e.name), at, into);
		else if (e.kind === 'file')
			into.update(`\0${at}\0`).update(files.read(path.join(dir, e.name)) ?? '');
		else into.update(`\0${at}\0${e.kind}`);
	}
}

/**
 * The build's identity on Kit's env channel: the server writes it beside the env, and the browser's
 * reader reads the env only when the channel bears its own. Both legs of one app make the same one
 * from the same facts: the app's package.json, base and app dir, and every file of its source but
 * dot files (ogygia's keep-client route is one, and is there for one leg only). A federated peer is
 * another app, so its reader never takes the host's env as its own; only a peer built from the very
 * same source shares it. It holds no absolute path and no time, so a build made again is
 * byte-identical. An app whose Kit env config sets no dynamic public variable (`kit_env_dynamic`)
 * has an empty env, so the server writes no channel and the browser reads none: it has no
 * identity (`''`, as a Kit 2 app has) and its source is not read.
 */
export function kit_env_build(app: KitEnvApp): string {
	if (!kit_env_dynamic(app)) return '';
	const hash = createHash('sha256').update([app.base, app.app_dir].join('\0'));
	hash.update('\0package.json\0').update(app.fs.read(path.join(app.root, 'package.json')) ?? '');
	const src = path.join(app.root, 'src');
	hash_tree(app.fs, src, 'src', hash);
	const routes = path.relative(src, app.routes_dir);
	if (routes.startsWith('..') || path.isAbsolute(routes))
		hash_tree(
			app.fs,
			app.routes_dir,
			path.relative(app.root, app.routes_dir).split(path.sep).join('/'),
			hash
		);
	return hash.digest('hex').slice(0, 12);
}

/** The identity the server module writes: the build's own, or, in dev, the dev server's of `root`
 *  as each channel is written, read through the dev bridge (dev-bridge.ts), so a dev app that
 *  gains its first dynamic public variable writes the identity its browser reader, made later, is
 *  bound to (apps/palaestra/e2e/kit3.spec.ts). */
export type KitEnvBuild =
	| { readonly kind: 'fixed'; readonly id: string }
	| { readonly kind: 'dev'; readonly root: string };

/**
 * `ogygia:server/kit-env` for the app's Kit major: Kit 3's `rendered_env`, the object Kit puts in its
 * boot payload as `env` on a csr=true page (public variables only, set again as Kit's server starts),
 * and the identity its channel is written with (`kit_env_build()`). Any other Kit: a `null` env.
 */
export function kit_public_env_module(major: number | null, build: KitEnvBuild): string {
	const id =
		build.kind === 'fixed'
			? `export function kit_env_build() { return ${JSON.stringify(build.id)}; }\n`
			: `export function kit_env_build() { return ${dev_bridge_call(build.root, 'kit_env_build')} ?? ''; }\n`;
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
