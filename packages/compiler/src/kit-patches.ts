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

const kit_public_env_re = (mode: string) =>
	new RegExp(`/generated/${mode}/env/public/client\\.js$`);
/** Kit 3's browser `$app/env/public`, as Kit generates it under its out dir (dev and build). */
export const KIT_PUBLIC_ENV_CLIENT_RE: RegExp = kit_public_env_re('(?:build|dev)');
const KIT_ENV_READER = `import { kit_env as __og_kit_env } from 'ogygia:boot/kit-env';\n`;
const DYNAMIC_READ_RE = /=\s*env\./;
const STRING_OR_COMMENT_G =
	/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const ENV_REFERENCE_RE = /(?<![\w$.])env(?![\w$]|\s*:)/;

function public_env_patch(read: string, fallback: string, inert: string | null): KitPatch['patch'] {
	return (code, id) => {
		if (code.trim() === '') return null;
		const bare = code.replace(STRING_OR_COMMENT_G, (m) => (m[0] === '/' ? ' ' : '""'));
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

/** What names an app on its env channel: only values the app already makes public. */
export interface KitEnvApp {
	/** the `name` of the app's package.json (`''` when it has none) */
	readonly name: string;
	/** Kit's resolved `paths.base` */
	readonly base: string;
	readonly app_dir: string;
	/** Kit's resolved `version.name`, which Kit serves at `<app dir>/version.json` (Kit's default
	 *  is fixed once per process); `null` when it could not be read */
	readonly version: string | null;
}

/** The `name` a package.json's `text` holds: `''` when there is none, or the text does not parse. */
export function package_name(text: string | null): string {
	if (text === null) return '';
	try {
		const name = (JSON.parse(text) as { name?: unknown } | null)?.name;
		return typeof name === 'string' ? name : '';
		// oxlint-disable-next-line ogygia/no-silent-failures -- a package.json that does not parse names no package: the identity is made from the other values
	} catch {
		return '';
	}
}

/**
 * The build's identity on Kit's env channel: the server writes it beside the env, and the browser's
 * reader reads the env only when the channel bears its own. It ships in every page with a channel,
 * so it is made only of values the app already makes public, never of a file of its source: its
 * package name, Kit's `paths.base`, app dir and Kit's `version.name`, as one digest. Both legs and
 * the dev server of one app make the same one from the same values. A federated peer built in
 * another process has another default `version.name` (Kit fixes it once per process), so another
 * identity, and its reader never takes the host's env as its own; an app that pins `version.name`
 * (to a commit, say) has one identity on every build of that version. Two apps with the same package
 * name, base and app dir share one when they pin the same version or are built in one process. It
 * holds no path, so one app built from two folders has one identity. With no `version.name` read
 * (no Kit setup plugin, so no `paths.base` either) it is made from the package name and app dir,
 * and `kit_env_version_unread` says so.
 */
export function kit_env_build(app: KitEnvApp): string {
	if (app.version === null) warn('kit_env_version_unread', { name: app.name || '(unnamed)' });
	return createHash('sha256')
		.update(JSON.stringify([app.name, app.base, app.app_dir, app.version]))
		.digest('hex')
		.slice(0, 12);
}

/**
 * `ogygia:server/kit-env` for the app's Kit major: Kit 3's `rendered_env`, the object Kit puts in its
 * boot payload as `env` on a csr=true page (public variables only, set again as Kit's server starts),
 * and the identity its channel is written with (`kit_env_build()`, the build's or the dev server's).
 * Any other Kit: a `null` env.
 */
export function kit_public_env_module(major: number | null, build: string): string {
	const id = `export function kit_env_build() { return ${JSON.stringify(build)}; }\n`;
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
