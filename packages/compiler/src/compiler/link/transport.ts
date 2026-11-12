import { OWN_SPECIFIER_SOURCE } from '@ogygia/core/contract';
import { dedent } from '@ogygia/core/contract';
import { file_token } from './file-token.ts';

/**
 * `ogygia:region/transport` emitter — re-exports the app's universal `transport` hook (or an empty
 * map) for the client remote wire codec. Universal hooks are isomorphic, so this is client-safe.
 * Pure over the resolved absolute path to the app's universal hooks module (or null).
 */
export function transport_module(
	universal_hooks: string | null,
	kit_codec: string | null = null
): string {
	if (!universal_hooks) {
		return dedent`
			export const transport = {};
			export const encoders = {};
			export const decoders = {};
		`;
	}
	// THE app codec, built once: every ogygia reader (page seed, remote seed, Kit's remote functions
	// through the client stub) takes `encoders`/`decoders` from here.
	const src = dedent`
		import * as hooks from ${JSON.stringify(universal_hooks)};

		export const transport = hooks.transport || {};
		const codecs = Object.entries(transport);
		export const encoders = Object.fromEntries(codecs.map(([k, v]) => [k, v.encode]));
		export const decoders = Object.fromEntries(codecs.map(([k, v]) => [k, v.decode]));
	`;
	if (!kit_codec) return src;
	return dedent`
		import { init_transport } from ${JSON.stringify(kit_codec)};
		${src}

		// Kit 3 (client leg): Kit's own codec module is a reader too — its remote argument encoding
		// reads it, and only Kit's client boot fills it otherwise (never on a csr=false page). Kit's
		// boot later fills it again with the same transport.
		init_transport(transport);
	`;
}

/**
 * `ogygia:region/kit-transport` emitter — the value behind the barrel's `ogygia.transport` (the Kit
 * `transport` hook the app spreads into its universal hooks). GENERATED per-app, not a fixed export:
 * the real `ogygiaTransport` statically pulls the whole codec cluster (wire/store/snippet/fn + region,
 * ~9 kB) since a wired value can nest any other kind. A **pure-island** app crosses NOTHING through
 * Kit's transport, so it gets an empty map and never bundles a decoder it can't use. `app_crosses_wire`
 * is the compiler's own knowledge (a transportable class / portable snippet → the `wire` mark, plus a
 * remote file or a `region`/content import) — never a scan for `ogygia.transport` in app source.
 * `dist_dir` is the resolvable path to ogygia's own dist.
 *
 * The REALM picks the transport: the browser's decodes every kind the server sends; the server's
 * (server/transport.ts) decodes only what a browser sent, a remote function's argument, and refuses
 * every ogygia kind there.
 */
export function kit_transport_module(
	app_crosses_wire: boolean,
	dist_dir: string,
	ssr: boolean
): string {
	if (!app_crosses_wire) return `export const transport = {};`;
	return ssr
		? `export { ogygiaServerTransport as transport } from ${JSON.stringify(`${dist_dir}/server/transport.js`)};`
		: `export { ogygiaTransport as transport } from ${JSON.stringify(`${dist_dir}/transport.js`)};`;
}

// A held region / transportable value can only reach Kit's `transport` hook through a value the app
// PRODUCES with a detectable API: `region()`/`<Region>` (a held region in a load/remote), or a content
// import (`site()`, `remotes()` — content bodies are held regions). Wired classes / portable snippets
// are already caught by the `wire` mark. A file with none of these can't put a transportable on Kit's
// wire — so scanning import CLAUSES is complete, not just conservative. Over-inclusion is the safe
// direction anyway (an unused codec is bytes; a missed one breaks decode). Regexes are module-level.
// (`ogygia` in an app; `@ogygia/core` in a plugin package's own modules)
const OGYGIA_WIRE_NAMED = new RegExp(
	`import\\s+(?:type\\s+)?\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${OWN_SPECIFIER_SOURCE}['"]`,
	'g'
);
const WIRE_API = /\b(?:region|Region|site)\b/;
const OGYGIA_CONTENT_IMPORT = /from\s*['"]@ogygia\/content(?:\/[a-z-]+)?['"]/;
const OGYGIA_NS_IMPORT = new RegExp(
	`import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*['"]${OWN_SPECIFIER_SOURCE}['"]`
);
const NS_WIRE_USAGE = /\b(\w+)\.(?:region|Region|site)\b/g;

/** True when `src` produces a held region / transportable value that can cross Kit's `transport`. */
export function source_crosses_wire(src: string): boolean {
	if (OGYGIA_CONTENT_IMPORT.test(src)) return true;
	OGYGIA_WIRE_NAMED.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = OGYGIA_WIRE_NAMED.exec(src))) if (WIRE_API.test(m[1])) return true;
	const ns = OGYGIA_NS_IMPORT.exec(src);
	if (!ns) return false;
	NS_WIRE_USAGE.lastIndex = 0;
	let u: RegExpExecArray | null;
	while ((u = NS_WIRE_USAGE.exec(src))) if (u[1] === ns[1]) return true;
	return false;
}

/**
 * `ogygia:region/transportables` emitter — where the `[ogygia.wire]` codecs come from, so an island
 * receiving a transportable prop never has to import the class itself. Per leg:
 * - SERVER: side-effect-imports every module that defines a transportable class (the region endpoint
 *   decodes signed props of any island; loaded once per process).
 * - CLIENT: NO eager import — every island page used to download every transportable class of the
 *   app. It exports `wire_loaders`, a class module's tag path (root-relative, the part of a tag
 *   before `#`) → a lazy import, with the file it imports and the URL that file is relative to (a
 *   failed download is asked for again there: vite/lazy-files.ts); the runtime loads just the ones
 *   an island's props carry (the server stamps them on its props sidecar) before it decodes them.
 * `modules` is the Program's set of transportable module paths (absolute).
 */
export function transportables_server_module(modules: Iterable<string>): string {
	const imports: string[] = [];
	for (const abs of modules) imports.push(`import ${JSON.stringify(abs)};`);
	return dedent`
		${imports.join('\n')}

		export const wire_loaders = {};
		export const wire_all = false;
	`;
}

/** The CLIENT leg of {@link transportables_server_module}'s module; `rel` makes a tag path. */
export function transportables_client_module(
	modules: Iterable<string>,
	rel: (abs: string) => string,
	/** the app sends wired values through Kit's `transport` (remote functions, loads): those decode
	 *  synchronously, whenever they arrive — every class must be in before any island wakes */
	crosses_wire = false
): string {
	const entries: string[] = [];
	for (const abs of modules)
		entries.push(
			`${JSON.stringify(rel(abs))}: [() => import(${JSON.stringify(abs)}), ${file_token(abs)}, import.meta.url]`
		);
	return dedent`
		export const wire_loaders = {
			${entries.join(',\n\t')}
		};
		export const wire_all = ${crosses_wire && entries.length > 0};
	`;
}
