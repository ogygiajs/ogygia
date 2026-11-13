import { parse } from 'svelte/compiler';
import MagicString from 'magic-string';
import type { SourceMap } from 'magic-string';
import { dedent } from '@ogygia/core/contract';
import type { IslandDescriptor } from '../program.ts';
import { createHash } from 'node:crypto';
import { foucCssVirtualId } from '../fouc-css.ts';
import { collectCaptureInfo, collect_pattern_names as pattern_names } from '../free-vars.ts';
import { parse_module } from '../parse/oxc.ts';
import { strategyKey, regionIdentity, regionId } from './identity.ts';
import { resolve_app_spec, type AppAlias, type AppSpecCtx } from '../app-spec.ts';
import { parse_trigger, SCHEDULE, WAKE } from '@ogygia/core/contract';
import { regionBindingVirtualId, region_family, wrapperVirtualId } from '../ids.ts';
import { OGYGIA_SCHEME } from '../virtual/table.ts';
import {
	island_entry_source,
	server_wrapper_source,
	lake_wrapper_source,
	make_region_binding,
	make_wake_island
} from './emit.ts';
import type { SvelteNode, HostImport, RegionMark } from './ir.ts';
import { check_marked_uses, marked_import_bindings, refuse_as_region } from './marked-imports.ts';
import path from 'node:path';
import { blank_styles } from '../blank-styles.ts';
import { OgygiaError, warn } from '../messages.ts';
import { say } from '@ogygia/machine';

const unparsed = say();
function warn_unparsed(id: string, err: unknown): void {
	unparsed.once(id, () => say_unparsed(id, err));
}
function say_unparsed(id: string, err: unknown): void {
	const e = err as { code?: string; start?: { line?: number; column?: number }; message?: string };
	warn('region_host_skipped', {
		file: id,
		reason: e.code ?? (e.message ?? 'parse error').split('\n')[0].slice(0, 80),
		at: e.start?.line ? `${e.start.line}:${(e.start.column ?? 0) + 1}` : ''
	});
}

interface HostCtx {
	root: string;
	libDir: string;
	readFile: (abs: string) => string | null;
	dev: boolean;
	virtualPathFor: (hostId: string, iid: string) => string;
	wrapperPathFor?: (hostId: string, iid: string) => string;
	devUrlFor: (virtualPath: string) => string;
	originOf?: (id: string) => string;
	pkg_identity?: (abs: string) => string | null;
	alias?: readonly AppAlias[];
	stat?: AppSpecCtx['stat'];
	appDir?: string;
	visibleMargin: string | undefined;
	presets: Record<string, unknown>;
	importKeys: Partial<ImportKeys> | undefined;
	idSalt?: string;
	linkVirtualIsland?: boolean;
	clientBindingStub?: string;
	routeCsr: boolean | undefined;
	ssr: boolean;
}

interface TsRegionCtx {
	root: string;
	libDir: string;
	dev: boolean;
	virtualPathFor: (hostId: string, iid: string) => string;
	devUrlFor: (virtualPath: string) => string;
	appDir?: string;
	importKeys: Partial<ImportKeys> | undefined;
	idSalt?: string;
	wrapperPathFor?: (hostId: string, iid: string) => string;
	visibleMargin?: string;
	pkg_identity?: (abs: string) => string | null;
	alias?: readonly AppAlias[];
	stat?: AppSpecCtx['stat'];
}

type OptErr = (names: string, msg: string) => Error;

const REGEXP_META = /[.*+?^${}()|[\]\\]/g;
const PATH_SEP = /[/\\]/;
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i;
const JS_EXT = /\.js$/;
const VIRTUAL_HOST_RE = /^\0?(?:virtual|ogygia):/;

export { foucCssVirtualId } from '../fouc-css.ts';

export const ISLAND_DIR = '.ogygia';

const ENTRY_PREFIX = region_family('entry');
const WRAPPER_PREFIX = region_family('wrapper');
const BINDING_PREFIX = region_family('binding');
const LAZY_PREFIX = region_family('lazy');

/** True for a GENERATED island glue id (virtual island entry / wrapper / region binding, or the legacy
 *  on-disk `.ogygia/` shape) — the ids that are ogygia's own emit, not authored app/component source. */
export function is_island_path(id: string): boolean {
	const bare = id.split('?')[0];
	return (
		(bare.startsWith(ENTRY_PREFIX) && (bare.endsWith('.js') || bare.endsWith('.svelte'))) ||
		(bare.startsWith(WRAPPER_PREFIX) && bare.endsWith('.svelte')) ||
		(bare.startsWith(BINDING_PREFIX) && bare.endsWith('.js')) ||
		(bare.startsWith(LAZY_PREFIX) && bare.endsWith('.js')) ||
		(bare.includes(`/${ISLAND_DIR}/`) && bare.endsWith('.svelte'))
	);
}

/**
 * Default import-attribute keys — the two-dial grammar. Internal role names stay `hydrate`/`defer`
 * (the wire format + runtime keep those anchors); the user-facing ATTRIBUTE names are the values.
 * Override via `ogygia({ importKeys })`.
 * - `render` attribute → the MODE: `static` (inline HTML) | `deferred` (a hole, fetched) | `live`
 *   (a hole that revalidates). Defaults to `static`.
 * - `fetch` attribute → a `deferred` hole's TIMING, when its HTML arrives (default `load`):
 *   `with { render: 'deferred', fetch: 'visible' }`.
 * - `wake` attribute → when an island's JS runs (`none`: a lake). Never a hole's timing.
 */
export const DEFAULT_IMPORT_KEYS = {
	wake: 'wake',
	fetch: 'fetch',
	render: 'render',
	preset: 'preset',
	region: 'region'
} as const;

/**
 * Import-attribute key names claimed by the transform
 * (`with { wake | fetch | render | preset | region }`). Override via `ogygia({ importKeys })` when
 * another tool already uses the default names.
 */
export type ImportKeys = {
	/** When an island's JS runs (default attribute `'wake'`); `'none'` makes a lake. For `live` it is
	 * the revalidate schedule. */
	wake: string;
	/** A `render: 'deferred'` hole's timing — when its HTML arrives (default attribute `'fetch'`):
	 * `'load'` | `'idle'` | `'visible'` | `'interaction'` | a media query. */
	fetch: string;
	/** The delivery MODE (default attribute `'render'`): `static` | `deferred` | `live`. */
	render: string;
	/** Named preset attribute (default `'preset'`). */
	preset: string;
	/** Held-across-a-boundary marker (default attribute `'region'`, only value `'raw'`) — a component
	 * a registry hands to `region()` where the transform can't see the call. */
	region: string;
};

/** The keys a region preset takes, by their standard names: a preset is config, so `importKeys`
 * never renames them. */
export const PRESET_KEYS: ReadonlySet<string> = new Set([
	'render',
	'wake',
	'fetch',
	'margin',
	'maxAge',
	'onExpire',
	'revalidate',
	'keep',
	'stitch',
	'prefetch'
]);

const RENDER_MODES: ReadonlySet<string> = new Set(['static', 'deferred', 'live']);

const JS_IDENT = /^[A-Za-z_$][\w$]*$/;

const STORE_CTORS: ReadonlySet<string> = new Set([
	'writable',
	'readable',
	'derived',
	'toStore',
	'fromStore'
]);
const STORE_SUB_RE = /\$([A-Za-z_][\w$]*)/g;
const RUNE_NAMES: ReadonlySet<string> = new Set([
	'state',
	'derived',
	'effect',
	'props',
	'bindable',
	'inspect',
	'host'
]);
function line_col(src: string, offset: number): string {
	let line = 1;
	let last = -1;
	for (let i = 0; i < offset; i++) {
		if (src.charCodeAt(i) === 10) {
			line++;
			last = i;
		}
	}
	return `${line}:${offset - last}`;
}
const store_warned = say();
function warn_once(key: string, speak: () => void): void {
	store_warned.once(key, speak);
}

const ATTR_SCHEMA: ReadonlySet<string> = new Set([
	'hydrate',
	'defer',
	'margin',
	'keep',
	'stitch',
	'prefetch'
]);
const CHILD_KEYS: readonly string[] = [
	'consequent',
	'alternate',
	'body',
	'fallback',
	'pending',
	'then',
	'catch',
	'fragment'
];

const NORMALIZED_CACHE = new WeakMap<object, ImportKeys>();
let DEFAULT_NORMALIZED: ImportKeys | null = null;
/**
 * Merge partial `importKeys` with {@link DEFAULT_IMPORT_KEYS}.
 * Rejects empty strings, non-identifiers, and colliding role names.
 *
 * @param overrides - Optional overrides for one or more roles.
 * @returns Fully resolved key map used by the transform.
 * @throws If a value is not a JS identifier or two roles share the same name.
 */
export function normalize_import_keys(overrides?: Partial<ImportKeys> | null): ImportKeys {
	if (overrides == null) return (DEFAULT_NORMALIZED ??= normalize_import_keys_uncached(null));
	const hit = NORMALIZED_CACHE.get(overrides);
	if (hit) return hit;
	const result = normalize_import_keys_uncached(overrides);
	NORMALIZED_CACHE.set(overrides, result);
	return result;
}

function normalize_import_keys_uncached(overrides?: Partial<ImportKeys> | null): ImportKeys {
	const wake = (overrides?.wake ?? DEFAULT_IMPORT_KEYS.wake).trim();
	const fetch = (overrides?.fetch ?? DEFAULT_IMPORT_KEYS.fetch).trim();
	const render = (overrides?.render ?? DEFAULT_IMPORT_KEYS.render).trim();
	const preset = (overrides?.preset ?? DEFAULT_IMPORT_KEYS.preset).trim();
	const region = (overrides?.region ?? DEFAULT_IMPORT_KEYS.region).trim();
	for (const [role, name] of [
		['wake', wake],
		['fetch', fetch],
		['render', render],
		['preset', preset],
		['region', region]
	] as const) {
		if (!name || !JS_IDENT.test(name)) {
			throw new OgygiaError('import_key_invalid', {
				role,
				got: String(JSON.stringify(overrides?.[role]))
			});
		}
	}
	if (new Set([wake, fetch, render, preset, region]).size !== 5) {
		throw new OgygiaError('import_keys_not_distinct');
	}
	return { wake, fetch, render, preset, region };
}

const HINT_CACHE = new WeakMap<ImportKeys, RegExp>();
/**
 * Cheap source-scan regex matching any of the configured import-attribute key names.
 * Used to skip AST work on hosts that cannot contain region imports.
 *
 * @param import_keys - Resolved key map from {@link normalize_import_keys}.
 */
export function import_keys_hint(import_keys: ImportKeys): RegExp {
	let re = HINT_CACHE.get(import_keys);
	if (re) return re;
	const esc = (s: string) => s.replace(REGEXP_META, '\\$&');
	re = new RegExp(
		`${esc(import_keys.wake)}|${esc(import_keys.fetch)}|${esc(import_keys.render)}|${esc(import_keys.preset)}|${esc(import_keys.region)}`
	);
	HINT_CACHE.set(import_keys, re);
	return re;
}

/** Deterministic short id for a region (stable across dev + build).
 * When `salt` is set (production `OGYGIA_SECRET`), ids are not offline-computable (P1-ID).
 * Paths are always posix so SSR/client builds agree across OS path separators. */
export function islandId(relHostPath: string, index: string | number, salt = ''): string {
	const rel = String(relHostPath).split(PATH_SEP).join('/');
	const msg = salt ? `${salt}\0${rel}::${index}` : `${rel}::${index}`;
	return createHash('md5').update(msg).digest('hex').slice(0, 12);
}

/**
 * The directory, under the app dir, of the STABLE names (an island's identity, the runtime's): not
 * `immutable/`. A host serves `immutable/` for a year by name (every adapter, every CDN rule written
 * for it), and a stable name keeps its name while its content follows each build: a year-old copy
 * would load another build's code. Here a host's ordinary rule revalidates them. The content-hashed
 * files they point at stay in `immutable/`.
 */
export const STABLE_NAME_DIR = 'ogygia';

/**
 * Deterministic client path of a hydrate island's stable name (mirrors the runtime's). SSR bakes it
 * into `<ogygia-region entry>` as the island's identity — a name, not a file: the content-hashed
 * entry is found through the handoff (the server) and the location maps (the browser,
 * link/location-map.ts), since Kit builds server before client.
 */
export function islandChunkFileName(iid: string, appDir = '_app') {
	return `${appDir}/${STABLE_NAME_DIR}/og-region.${iid}.js`;
}

/** App-internal URL for {@link islandChunkFileName}: `/<appDir>/ogygia/…` (leading slash, appDir,
 *  NO base). It is what SSR bakes onto `<ogygia-region entry>`; `Region.svelte` runs it through Kit's
 *  `asset()` at render time, which is the sole authority on `base` / the assets CDN / relative paths —
 *  so a base is never baked here (that would double-apply it). NOT the on-disk output filename. */
export function islandPublicUrl(iid: string, appDir = '_app'): string {
	return `/${islandChunkFileName(iid, appDir)}`;
}

/**
 * csr=false CLIENT host binding target. Kit still emits those page nodes; pointing marked
 * imports here (instead of wrappers) keeps N island wrappers/entries out of the page graph so
 * `emitFile` owns hydrate modules and Rolldown does not thin-facade them. Hydration uses
 * `import(entry)` only — this stub is never loaded for island JS.
 *
 * Beside the stub the transform emits `import 'ogygia:region/fouc-css/<entry>'` so Kit still
 * links stylesheets (FOUC) via CSS-only side effects. Importing the full `.svelte` JS module
 * dual-owns it with the emitFile island entry and Rolldown thin-facades `og-region.*`.
 * Omitting CSS entirely orphans rules (scoped class hashes, no stylesheet).
 */
export const CLIENT_BINDING_STUB: string = region_family('client_binding_stub');

export { strategyKey, regionIdentity, regionId };
export { regionBindingVirtualId, wrapperVirtualId };

/**
 * The `with { region: … }` marker has ONE value — `'raw'` (an adjective: "a raw/held region"). It
 * carries NO schedule: the wake timing is set at the `region()` call (`region(C, props, { wake })`)
 * or, in a block tree, per node. This is the only surviving import-attribute marker for a component
 * a registry hands to `region()` where the transform can't see the call site.
 *
 * @param raw the marker value
 * @param where host label for error messages
 * @param regionKey configured `region` attribute name (for the message)
 */
export function normalize_region_value(raw: string, where: string, regionKey = 'region'): void {
	const v = (raw ?? '').trim();
	if (v === 'raw') return;
	throw new OgygiaError('region_value_not_raw', { host: where, key: regionKey });
}

/**
 * Validate a `wake:` schedule value on a held import (a `.ts` registry / remote). Accepts the wake
 * strategies (`load` / `idle` / `visible` / `interaction`) or a media query — the same vocabulary as
 * a placed island's `wake:`. Returns the value unchanged (it becomes the baked `__hydrate`).
 */
export function normalize_hydrate_value(raw: string, where: string, wakeKey = 'wake'): string {
	const v = (raw ?? '').trim();
	if (parse_trigger(v, WAKE)) return v;
	throw new OgygiaError('wake_strategy_unknown', { host: where, key: wakeKey, value: v });
}

function clean_import_text(source: string, node: SvelteNode) {
	return `${source.slice(node.start, node.source.end)};`;
}

function region_keys_on_dynamic_import(node: SvelteNode, import_keys: ImportKeys) {
	const opts = node.options;
	if (!opts || opts.type !== 'ObjectExpression') return [];
	const claimed = new Set([
		import_keys.wake,
		import_keys.fetch,
		import_keys.render,
		import_keys.preset,
		import_keys.region
	]);
	const found: string[] = [];
	for (const prop of opts.properties) {
		if (prop.type !== 'Property' || prop.computed) continue;
		const bag_key =
			prop.key.type === 'Identifier'
				? prop.key.name
				: prop.key.type === 'Literal'
					? String(prop.key.value)
					: null;
		if (bag_key !== 'with' && bag_key !== 'assert') continue;
		if (prop.value.type !== 'ObjectExpression') continue;
		for (const atr of prop.value.properties) {
			if (atr.type !== 'Property' || atr.computed) continue;
			const ak =
				atr.key.type === 'Identifier'
					? atr.key.name
					: atr.key.type === 'Literal'
						? String(atr.key.value)
						: null;
			if (ak && claimed.has(ak) && !found.includes(ak)) found.push(ak);
		}
	}
	return found;
}

function reject_dynamic_region_imports(body: SvelteNode[], import_keys: ImportKeys, host: string) {
	const walk = (node: SvelteNode) => {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'ImportExpression') {
			const keys = region_keys_on_dynamic_import(node, import_keys);
			if (keys.length)
				throw new OgygiaError('dynamic_region_import', {
					host,
					keys: keys.join(', '),
					wake_key: import_keys.wake,
					render_key: import_keys.render,
					preset_key: import_keys.preset
				});
		}
		for (const k of Object.keys(node)) {
			if (k === 'start' || k === 'end' || k === 'loc') continue;
			const v = node[k];
			if (Array.isArray(v)) for (const c of v) walk(c);
			else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
		}
	};
	for (const n of body ?? []) walk(n);
}

function script_lang_attr(scriptNode: SvelteNode) {
	if (!scriptNode) return '';
	for (const attr of scriptNode.attributes ?? []) {
		if (attr.name === 'lang' && Array.isArray(attr.value) && attr.value[0]?.data) {
			return ` lang="${attr.value[0].data}"`;
		}
	}
	return '';
}

const REMOUNT_ON_EXPIRE: ReadonlySet<string> = new Set(['empty', 'fetch']);

function parse_max_age(raw: unknown, err: OptErr, names: string) {
	if (raw == null) return undefined;
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0) {
			throw err(names, `\`remount.maxAge\` must be a non-negative number (ms), got ${raw}.`);
		}
		return Math.floor(raw);
	}
	if (typeof raw === 'string') {
		const m = raw.trim().match(DURATION);
		if (!m) {
			throw err(
				names,
				`unknown remount.maxAge '${raw}'. Use a number (ms) or a duration like '30s' | '5m' | '1h'.`
			);
		}
		const n = Number(m[1]);
		const unit = (m[2] || 'ms').toLowerCase();
		const mult = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
		return Math.floor(n * mult);
	}
	throw err(names, `\`remount.maxAge\` must be a number (ms) or duration string.`);
}

function parse_cache_ttl_sec(raw: unknown, err: OptErr, names: string) {
	if (raw == null) return undefined;
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0) {
			throw err(names, `\`maxAge\` must be a non-negative number of seconds, got ${raw}.`);
		}
		return Math.floor(raw);
	}
	if (typeof raw === 'string') {
		const m = raw.trim().match(DURATION);
		if (!m) {
			throw err(
				names,
				`unknown \`maxAge\` '${raw}'. Use seconds (a number) or a duration like '30s' | '5m' | '1h'.`
			);
		}
		const n = Number(m[1]);
		const unit = (m[2] || 's').toLowerCase();
		const secs = unit === 'ms' ? n / 1000 : unit === 's' ? n : unit === 'm' ? n * 60 : n * 3600;
		return Math.floor(secs);
	}
	throw err(names, `\`maxAge\` must be a number of seconds or a duration string.`);
}

function parse_remount(
	ro: { revalidate: unknown; maxAge?: unknown; onExpire?: unknown },
	err: OptErr,
	names: string
) {
	const out: { policy: string; when?: string; maxAgeMs?: number; onExpire?: string } = {
		policy: 'cache'
	};

	if (ro.revalidate === true) {
		throw err(
			names,
			`\`remount.revalidate: true\` is invalid — use 'load' (or 'idle' | 'visible' | a media query).`
		);
	}
	if (ro.revalidate !== false && ro.revalidate != null) {
		const rev = String(ro.revalidate);
		if (!parse_trigger(rev, SCHEDULE)) {
			throw err(
				names,
				`unknown remount.revalidate '${rev}'. Use false | 'load' | 'idle' | 'visible' | a media query.`
			);
		}
		out.policy = 'swr';
		out.when = rev;
	}

	if (ro.onExpire != null) {
		const oe = String(ro.onExpire);
		if (!REMOUNT_ON_EXPIRE.has(oe)) {
			throw err(names, `unknown remount.onExpire '${oe}'. Use 'empty' | 'fetch'.`);
		}
		if (out.policy === 'cache' && oe === 'fetch') {
			throw err(
				names,
				`\`onExpire: 'fetch'\` requires \`revalidate\` (a schedule). Pure cache expires to empty — use { revalidate: 'load', maxAge, onExpire: 'fetch' } for SWR past maxAge.`
			);
		}
		out.onExpire = oe;
	}

	if (ro.maxAge != null) {
		out.maxAgeMs = parse_max_age(ro.maxAge, err, names);
	}

	return out;
}

const SWR_EVENT_ATTR: ReadonlySet<string> = new Set([
	'onclick',
	'ondblclick',
	'oncontextmenu',
	'onauxclick',
	'onpointerdown',
	'onpointerup',
	'onpointermove',
	'onpointerenter',
	'onpointerleave',
	'onpointercancel',
	'onpointerover',
	'onpointerout',
	'onmousedown',
	'onmouseup',
	'onmousemove',
	'onmouseenter',
	'onmouseleave',
	'onmouseover',
	'onmouseout',
	'onkeydown',
	'onkeyup',
	'onkeypress',
	'onfocus',
	'onblur',
	'onfocusin',
	'onfocusout',
	'oninput',
	'onbeforeinput',
	'onchange',
	'onsubmit',
	'onreset',
	'onscroll',
	'onwheel',
	'ontouchstart',
	'ontouchend',
	'ontouchmove',
	'ontouchcancel',
	'ondrag',
	'ondragstart',
	'ondragend',
	'ondragenter',
	'ondragleave',
	'ondragover',
	'ondrop',
	'oncopy',
	'oncut',
	'onpaste',
	'onanimationstart',
	'onanimationend',
	'onanimationiteration',
	'ontransitionend',
	'ontransitionrun',
	'ontransitionstart',
	'ontransitioncancel',
	'onload',
	'onerror',
	'ontoggle',
	'onselect',
	'oninvalid',
	'onformdata'
]);

function is_component_node(
	n: SvelteNode
): n is SvelteNode & { type: 'Component'; name: string; start: number; end: number } {
	return n.type === 'Component';
}

function assert_swr_lake_crossable(node: SvelteNode, err: (name: string, msg: string) => void) {
	const kids = (node.fragment?.nodes ?? []).filter(
		(n: SvelteNode) => !(n.type === 'Text' && !String(n.data ?? '').trim())
	);
	if (kids.length) {
		throw err(
			node.name,
			`\`render: 'live'\` region <${node.name}> cannot have children — the revalidate endpoint re-renders it from serialized props only, so snippets cannot cross. Move the content inside the component, or make it a static lake with \`wake: 'none'\`.`
		);
	}
	for (const attr of node.attributes ?? []) {
		if (attr.type === 'SpreadAttribute') continue;
		if (attr.type !== 'Attribute') {
			throw err(
				node.name,
				`\`render: 'live'\` region <${node.name}> cannot use \`${attr.type === 'BindDirective' ? `bind:${attr.name}` : attr.name || attr.type}\` — only plain attributes and spreads can be serialized for the revalidate endpoint.`
			);
		}
		const name = attr.name;
		if (typeof name === 'string' && SWR_EVENT_ATTR.has(name)) {
			throw err(
				node.name,
				`\`render: 'live'\` region <${node.name}> cannot use \`${name}\` — event/callback attributes cannot be serialized for the revalidate endpoint. Pass serializable data props instead.`
			);
		}
		const val = attr.value;
		const chunk_list = Array.isArray(val) ? val : val != null && val !== true ? [val] : [];
		for (const chunk of chunk_list) {
			const t = chunk?.expression?.type;
			if (t === 'ArrowFunctionExpression' || t === 'FunctionExpression') {
				throw err(
					node.name,
					`\`render: 'live'\` region <${node.name}> cannot use a function value for \`${name}\` — functions cannot be serialized for the revalidate endpoint.`
				);
			}
		}
	}
}

function resolve_component_path(spec: string, host_id: string, ctx: HostCtx) {
	if (typeof spec !== 'string' || !spec.trim()) return null;
	if (spec.startsWith('.') && VIRTUAL_HOST_RE.test(host_id)) {
		throw new OgygiaError('generated_module_relative_import', { host: host_id, specifier: spec });
	}
	return resolve_app_spec(spec, host_id, ctx) ?? spec;
}

function is_wake_island(mark: RegionMark): boolean {
	return mark.strategy !== 'server' && mark.strategy !== 'held' && mark.strategy !== 'lake';
}

export function transformHost(
	source: string,
	id: string,
	ctx: HostCtx
):
	| { code: string; map: SourceMap; islands: never[] }
	| { code: string; map: SourceMap; islands: IslandDescriptor[]; hasWireCrossing: boolean }
	| null {
	return new FileCompilation(source, id, ctx).run();
}

class FileCompilation {
	#source: string;
	#id: string;
	#ctx: HostCtx;
	#ast!: SvelteNode;
	#instance_body!: SvelteNode[];
	#module_body!: SvelteNode[];
	#lang!: string;
	#rel_host!: string;
	#import_keys: ImportKeys;
	#imports!: Map<string, HostImport>;
	#marked_components!: Map<string, RegionMark>;
	#imports_to_strip!: Set<{ start: number; end: number }>;
	#export_names!: Map<string, string>;
	#has_island_children!: boolean;
	#static_placed!: Set<string>;
	#has_island_hint!: boolean;
	#to_kit: Array<{ start: number; end: number; text: string }> = [];

	// @why Kit hydrates a csr=true route host, so its wake islands are Kit's plain components; the regions the server drives stay (test: test/csr-true-host-regions.test.ts › a csr=true route host keeps the regions the server drives, as a shared component does)
	#kit_owns(mark: RegionMark): boolean {
		return this.#ctx.routeCsr === true && is_wake_island(mark);
	}

	#kit_only() {
		const s = new MagicString(this.#source);
		for (const edit of this.#to_kit) s.overwrite(edit.start, edit.end, edit.text);
		return {
			code: s.toString(),
			map: s.generateMap({ hires: true, source: this.#id, includeContent: true }),
			islands: []
		};
	}

	constructor(source: string, id: string, ctx: HostCtx) {
		this.#source = source;
		this.#id = id;
		this.#ctx = ctx;
		this.#import_keys = normalize_import_keys(ctx.importKeys);
	}

	run() {
		const early = this.#analyze();
		if (early) return early.done;
		return this.#lower();
	}

	#referenced_names(skip?: Set<SvelteNode>) {
		const names = new Set<string>();
		const walk = (node: SvelteNode) => {
			if (!node || typeof node !== 'object') return;
			if (node.type === 'Identifier') names.add(node.name);
			else if (node.type === 'Component') {
				const n: string = node.name || '';
				names.add(n);
				for (let i = n.indexOf('.'); i !== -1; i = n.indexOf('.', i + 1)) names.add(n.slice(0, i));
			}
			for (const k of Object.keys(node)) {
				if (k === 'start' || k === 'end' || k === 'loc') continue;
				const v = node[k];
				if (Array.isArray(v)) for (const c of v) walk(c);
				else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
			}
		};
		for (const n of this.#instance_body)
			if (n.type !== 'ImportDeclaration' && !skip?.has(n)) walk(n);
		for (const n of this.#module_body) if (n.type !== 'ImportDeclaration') walk(n);
		for (const n of this.#ast.fragment?.nodes ?? []) walk(n);
		return names;
	}

	#used_names?: Set<string>;

	#marked_import_referenced(local: string) {
		return (this.#used_names ??= this.#referenced_names()).has(local);
	}

	#resolve_region_mark(
		inline: Map<string, string>,
		fail: (msg: string) => Error
	): { strategy: string; options: Record<string, unknown> } | null {
		const import_keys = this.#import_keys;
		const ctx = this.#ctx;
		const rel_host = this.#rel_host;
		const REGION_KEYS = [
			import_keys.wake,
			import_keys.fetch,
			import_keys.render,
			import_keys.preset,
			import_keys.region
		];
		const err_shim = (_names: string, msg: string) => fail(msg);
		if (inline.has('partial') && !REGION_KEYS.includes('partial')) {
			throw fail(
				`the \`partial\` import attribute was retired. Mark a held-across-a-boundary component with \`${import_keys.region}: 'raw'\` (schedule set at the \`region()\` call), or bake a schedule with a \`${import_keys.wake}:\` mark.`
			);
		}
		if (!REGION_KEYS.some((k) => inline.has(k))) return null;

		if (inline.has(import_keys.region)) {
			if (inline.size > 1) {
				throw fail(
					`\`${import_keys.region}\` must be the only import attribute — it only marks a held region ('raw'); set the wake schedule at the \`region()\` call.`
				);
			}
			normalize_region_value(inline.get(import_keys.region)!, rel_host, import_keys.region);
			return { strategy: 'held', options: {} };
		}

		const attrs = new Map<string, string>();
		let remount_opt:
			| { policy: string; when?: string; maxAgeMs?: number; onExpire?: string }
			| undefined;
		let from_preset: string | null = null;
		let render_mode: string | undefined;
		let wake_val: string | undefined;
		let fetch_val: string | undefined;
		const live_opts: { revalidate?: unknown; maxAge?: unknown; onExpire?: unknown } = {};
		if (inline.has(import_keys.preset)) {
			if (inline.size > 1) {
				throw fail(
					`\`${import_keys.preset}\` must be the only import attribute — put its options (margin, maxAge, …) in the preset definition (ogygia({ presets })).`
				);
			}
			from_preset = inline.get(import_keys.preset)!;
			const preset = ctx.presets && ctx.presets[from_preset];
			if (!preset) {
				const avail = Object.keys(ctx.presets || {});
				throw fail(
					`unknown ${import_keys.preset} '${from_preset}'. Available: ${avail.length ? avail.join(', ') : '(none)'}.`
				);
			}
			for (const [k, v] of Object.entries(preset)) {
				if (v == null) continue;
				if (k === 'render') render_mode = String(v);
				else if (k === 'wake') wake_val = String(v);
				else if (k === 'fetch') fetch_val = String(v);
				else if (k === 'maxAge' || k === 'onExpire' || k === 'revalidate') live_opts[k] = v;
				else if (k === 'margin' || k === 'keep' || k === 'prefetch') attrs.set(k, String(v));
				else if (k === 'stitch') {
					if (v !== true && v !== 'serve' && v !== 'edge') {
						throw fail(
							`preset '${from_preset}': \`stitch\` takes \`true\` / 'serve' (the hole fills at ORIGIN on every serve) or 'edge' (an ESI include the CDN fills — the shell stays edge-cached).`
						);
					}
					attrs.set('stitch', v === 'edge' ? 'edge' : 'serve');
				} else {
					throw fail(
						`unknown key \`${k}\` in preset '${from_preset}'. Use ${[...PRESET_KEYS].map((key) => `\`${key}\``).join(', ')}.`
					);
				}
			}
		} else {
			for (const k of inline.keys()) {
				if (
					k !== import_keys.wake &&
					k !== import_keys.fetch &&
					k !== import_keys.render &&
					k !== 'keep' &&
					k !== 'stitch' &&
					k !== 'prefetch'
				) {
					throw fail(
						`\`${k}\` is not allowed inline. Use \`${import_keys.wake}\`, \`${import_keys.fetch}\`, \`${import_keys.render}\`, \`keep\`, \`stitch\`, \`prefetch\`, or a named \`${import_keys.preset}\` — options like \`margin\` / \`maxAge\` belong in plugin config (ogygia({ presets })).`
					);
				}
			}
			if (inline.has(import_keys.render)) render_mode = inline.get(import_keys.render);
			if (inline.has(import_keys.wake)) wake_val = inline.get(import_keys.wake);
			if (inline.has(import_keys.fetch)) fetch_val = inline.get(import_keys.fetch);
			if (inline.has('keep')) attrs.set('keep', inline.get('keep')!);
			if (inline.has('prefetch')) attrs.set('prefetch', inline.get('prefetch')!);
			if (inline.has('stitch')) {
				const mode = inline.get('stitch');
				if (mode !== 'serve' && mode !== 'edge') {
					throw fail(
						`\`stitch: '${mode}'\` — the inline values are \`stitch: 'serve'\` (the hole fills at ORIGIN on every serve) or \`stitch: 'edge'\` (an ESI include the CDN fills — the shell stays edge-cached).`
					);
				}
				attrs.set('stitch', mode);
			}
		}

		if (render_mode != null && !RENDER_MODES.has(render_mode)) {
			throw fail(
				`unknown ${import_keys.render} '${render_mode}'. Use 'static' (inline HTML) | 'deferred' (a hole, fetched) | 'live' (a hole that revalidates).`
			);
		}
		const said = from_preset ? `preset '${from_preset}'` : 'this import';
		if (render_mode === 'deferred' && wake_val != null) {
			if (fetch_val != null) {
				throw fail(
					`${said} times a \`${import_keys.render}: 'deferred'\` hole twice, with \`${import_keys.fetch}: '${fetch_val}'\` and \`${import_keys.wake}: '${wake_val}'\`. Keep \`${import_keys.fetch}\`: it says when a hole's HTML arrives.`
				);
			}
			warn_once(`deferred-wake:${rel_host}:${said}:${wake_val}`, () =>
				warn('hole_wake_deprecated', {
					host: rel_host,
					said,
					render_key: import_keys.render,
					wake_key: import_keys.wake,
					fetch_key: import_keys.fetch,
					value: wake_val
				})
			);
			fetch_val = wake_val;
		}
		if (fetch_val != null && render_mode !== 'deferred') {
			throw fail(
				`${said} sets \`${import_keys.fetch}: '${fetch_val}'\` without \`${import_keys.render}: 'deferred'\` — \`${import_keys.fetch}\` is a hole's timing. Write \`${import_keys.render}: 'deferred', ${import_keys.fetch}: '${fetch_val}'\` for a hole${
					render_mode == null ? `, or \`${import_keys.wake}: '${fetch_val}'\` for an island.` : '.'
				}`
			);
		}
		if (render_mode === 'deferred') {
			attrs.set('defer', fetch_val ?? 'load');
		} else if (render_mode === 'live') {
			attrs.set('hydrate', 'none');
			remount_opt = parse_remount(
				{
					revalidate: wake_val ?? live_opts.revalidate ?? 'load',
					...(live_opts.maxAge != null ? { maxAge: live_opts.maxAge } : {}),
					...(live_opts.onExpire != null ? { onExpire: live_opts.onExpire } : {})
				},
				err_shim,
				''
			);
		} else if (wake_val != null) {
			attrs.set('hydrate', wake_val);
		}
		if (render_mode === 'static' && wake_val == null) {
			throw fail(
				`${said} sets \`${import_keys.render}: 'static'\` alone, which marks nothing: 'static' is how a region renders when nothing else is said. Drop it for a plain import, or add \`${import_keys.wake}\` for an island.`
			);
		}
		if (attrs.has('keep') && (!attrs.has('hydrate') || attrs.get('hydrate') === 'none')) {
			throw fail(
				`\`keep\` keeps a waking island alive across navigations, and ${said} makes no waking island (a hole, a lake or a live region has none to keep). Drop \`keep\`, or mark it with \`${import_keys.wake}: 'load'\` (or another wake).`
			);
		}
		if (attrs.has('stitch') && !attrs.has('defer')) {
			throw fail(
				`\`stitch\` is only valid with \`${import_keys.render}: 'deferred'\` — it says WHERE a hole fills on artifact serves; there is no hole without 'deferred'.`
			);
		}
		if (attrs.has('prefetch') && !attrs.has('defer')) {
			throw fail(
				`\`prefetch\` is only valid with \`${import_keys.render}: 'deferred'\` — it warms a hole's HTML ahead of its \`${import_keys.fetch}\` timing; an island's JS is preloaded by the runtime when it wakes, not by \`prefetch\`.`
			);
		}
		if (from_preset && !attrs.has('hydrate') && !attrs.has('defer')) {
			throw fail(
				`${import_keys.preset} '${from_preset}' must set \`render\` or \`wake\` — a margin-only (or empty) preset is a no-op.`
			);
		}

		for (const k of attrs.keys()) {
			if (!ATTR_SCHEMA.has(k)) {
				throw fail(
					from_preset
						? `unknown key \`${k}\` in preset '${from_preset}'.`
						: `unknown import attribute \`${k}\`.`
				);
			}
		}
		if (remount_opt && attrs.get('hydrate') !== 'none') {
			throw fail(`\`remount\` is only valid with \`${import_keys.wake}: 'none'\`.`);
		}

		if (attrs.has('defer')) {
			const dval = attrs.get('defer')!;
			let when: string;
			if (parse_trigger(dval, WAKE)) when = dval;
			else
				throw fail(
					`\`${import_keys.render}: 'deferred'\` fetches on its \`${import_keys.fetch}\` timing, but '${dval}' is not one. Use \`${import_keys.fetch}: 'load' | 'idle' | 'visible' | 'interaction'\` or a media query (not 'none' — a hole must fetch).`
				);
			const options: {
				when: string;
				margin?: string;
				cacheTtlSec?: number;
				stitch?: 'serve' | 'edge';
				prefetch?: string;
			} = { when };
			if (attrs.has('prefetch')) {
				const p = attrs.get('prefetch')!;
				if (!parse_trigger(p, SCHEDULE)) {
					throw fail(
						`\`prefetch: '${p}'\` — a hole prefetches its HTML on 'load' | 'idle' | 'visible' | a media query. Never 'interaction': that is the SWAP, \`${import_keys.fetch}\`'s job; prefetch only warms the bytes ahead of it.`
					);
				}
				if (p === when) {
					throw fail(
						`\`prefetch: '${p}'\` is this hole's own \`${import_keys.fetch}\` schedule — it adds nothing. Prefetch EARLIER than the swap ('load' | 'idle' | 'visible' for an 'interaction' hole), or drop it.`
					);
				}
				options.prefetch = p;
			}
			if (when === 'visible' || options.prefetch === 'visible')
				options.margin = attrs.get('margin') ?? ctx.visibleMargin ?? undefined;
			if (live_opts.maxAge != null) {
				const ttl = parse_cache_ttl_sec(live_opts.maxAge, err_shim, '');
				if (ttl != null && ttl > 0) options.cacheTtlSec = ttl;
			}
			if (attrs.has('stitch')) options.stitch = attrs.get('stitch') as 'serve' | 'edge';
			return { strategy: 'server', options };
		}

		if (attrs.has('hydrate')) {
			const val = attrs.get('hydrate')!;
			if (val === 'none') {
				const lake_opts: {
					remount?: string;
					when?: string;
					margin?: string;
					maxAgeMs?: number;
					onExpire?: string;
				} = {};
				if (remount_opt) {
					lake_opts.remount = remount_opt.policy;
					if (remount_opt.when) lake_opts.when = remount_opt.when;
					if (remount_opt.maxAgeMs != null) lake_opts.maxAgeMs = remount_opt.maxAgeMs;
					if (remount_opt.onExpire) lake_opts.onExpire = remount_opt.onExpire;
					if (remount_opt.policy === 'swr' && remount_opt.when === 'visible') {
						lake_opts.margin = attrs.get('margin') ?? ctx.visibleMargin ?? undefined;
					}
				}
				return { strategy: 'lake', options: lake_opts };
			}
			if (val === 'false') {
				throw fail(
					`\`${import_keys.wake}: 'false'\` is not valid — use \`${import_keys.wake}: 'none'\` for a lake (a frozen region inside a hydrated island). See DESIGN.md.`
				);
			}
			let strategy: string;
			if (parse_trigger(val, WAKE)) strategy = val;
			else
				throw fail(
					`unknown ${import_keys.wake} strategy '${val}'. Use 'load' | 'idle' | 'visible' | 'interaction' | a media query.`
				);
			const options: { margin?: string; keep?: string } = {};
			if (strategy === 'visible')
				options.margin = attrs.get('margin') ?? ctx.visibleMargin ?? undefined;
			if (attrs.has('keep')) {
				const p = String(attrs.get('keep')).trim();
				if (!p) throw fail(`\`keep\` needs a non-empty name (e.g. keep: 'player').`);
				options.keep = p;
			}
			return { strategy, options };
		}
		return null;
	}

	#assert_portable_children(node: SvelteNode, local: string, is_server: boolean) {
		const kids = (node.fragment?.nodes ?? []).filter(
			(n: SvelteNode) => !(n.type === 'Text' && !String(n.data ?? '').trim())
		);
		if (kids.length === 0) return;
		const only_fallback =
			is_server &&
			kids.length === 1 &&
			kids[0].type === 'SnippetBlock' &&
			kids[0].expression?.name === 'ogygiaFallback';
		if (only_fallback) return;
		throw new OgygiaError('region_children_not_portable', {
			host: this.#rel_host,
			tag: local,
			server: is_server
		});
	}

	#visit_usages(nodes: SvelteNode[]) {
		for (const node of nodes ?? []) {
			if (node.type === 'Component') {
				const name = node.name || '';
				if (name.includes('.')) {
					const root = name.split('.')[0];
					if (
						this.#marked_components.has(root) &&
						this.#marked_components.get(root)!.strategy !== 'lake'
					) {
						throw new OgygiaError('region_dotted_tag', {
							host: this.#rel_host,
							tag: name,
							import: root
						});
					}
				} else if (this.#marked_components.has(name)) {
					this.#static_placed.add(name);
					const mark = this.#marked_components.get(name)!;
					if (mark.strategy === 'lake') {
						if (mark.options?.remount === 'swr')
							assert_swr_lake_crossable(node, (specifiers: string, msg: string) =>
								this.#err(specifiers, msg)
							);
					} else if (mark.strategy === 'server' || mark.strategy === 'held') {
						this.#assert_portable_children(node, name, mark.strategy === 'server');
					} else {
						const kids = (node.fragment?.nodes ?? []).filter(
							(n: SvelteNode) => !(n.type === 'Text' && !String(n.data ?? '').trim())
						);
						if (kids.length) this.#has_island_children = true;
					}
				}
			}
			for (const k of CHILD_KEYS) if (node[k]?.nodes) this.#visit_usages(node[k].nodes);
		}
	}

	#posix_rel(abs: string) {
		return path.relative(this.#ctx.root, abs).split(PATH_SEP).join('/');
	}

	#component_identity(p: string) {
		if (!path.isAbsolute(p)) return p;
		const pkg = typeof this.#ctx.pkg_identity === 'function' ? this.#ctx.pkg_identity(p) : null;
		return pkg ?? this.#posix_rel(p);
	}

	#err(specifiers: string, msg: string) {
		return new OgygiaError('region_import_invalid', {
			host: this.#rel_host,
			names: specifiers,
			problem: msg
		});
	}

	#analyze() {
		const source = this.#source;
		const id = this.#id;
		const ctx = this.#ctx;
		const import_keys = this.#import_keys;
		const has_island_hint = import_keys_hint(import_keys).test(source);

		if (!has_island_hint && !source.includes('{#snippet') && !source.includes('asRegion')) {
			return { done: null };
		}

		let ast: SvelteNode;
		try {
			ast = parse(blank_styles(source), { modern: true, filename: id });
		} catch (err) {
			warn_unparsed(id, err);
			return { done: null };
		}

		const instance_body = ast.instance?.content?.body ?? [];
		const module_body = ast.module?.content?.body ?? [];
		const lang = script_lang_attr(ast.instance) || script_lang_attr(ast.module);

		const rel_host = (this.#rel_host = path.relative(ctx.root, id).split(PATH_SEP).join('/'));

		reject_dynamic_region_imports(instance_body, import_keys, rel_host);
		reject_dynamic_region_imports(module_body, import_keys, rel_host);

		const imports = new Map();
		const marked_components = (this.#marked_components = new Map());
		const imports_to_strip = new Set<{ start: number; end: number }>();

		const roots = [ast.instance?.content, ast.module?.content, ast.fragment];
		refuse_as_region(roots, source, rel_host);

		const marked_imports = new Map<string, { node: SvelteNode; exportName: string }>();
		const export_names = new Map<string, string>();
		const region_keys = [
			import_keys.wake,
			import_keys.fetch,
			import_keys.render,
			import_keys.preset,
			import_keys.region,
			'partial'
		];
		for (const node of instance_body) {
			if (node.type !== 'ImportDeclaration') continue;
			const cleaned = clean_import_text(source, node);
			for (const spec of node.specifiers) imports.set(spec.local.name, { node, cleaned });

			const attr_list = (node.attributes ?? []).filter(
				(a: SvelteNode) => a.type === 'ImportAttribute'
			);
			if (attr_list.length === 0) continue;

			const inline = new Map();
			for (const a of attr_list) inline.set(a.key.name ?? a.key.value, String(a.value.value));
			if (!region_keys.some((k) => inline.has(k))) continue;
			const bindings = marked_import_bindings(node, source, rel_host);
			const names = bindings.map((b) => b.local).join(', ');
			const mark = this.#resolve_region_mark(inline, (m) => this.#err(names, m));
			if (!mark) continue;
			for (const b of bindings) marked_imports.set(b.local, { node, exportName: b.exportName });
			if (this.#kit_owns(mark)) {
				this.#to_kit.push({ start: node.start, end: node.end, text: cleaned });
				continue;
			}
			for (const b of bindings) {
				marked_components.set(b.local, mark);
				export_names.set(b.local, b.exportName);
			}
		}
		check_marked_uses(roots, marked_imports, source, rel_host);

		if (marked_components.size === 0 && !source.includes('{#snippet')) {
			return { done: this.#to_kit.length ? this.#kit_only() : null };
		}

		this.#has_island_children = false;
		this.#static_placed = new Set();
		this.#visit_usages(ast.fragment?.nodes ?? []);

		this.#ast = ast;
		this.#instance_body = instance_body;
		this.#module_body = module_body;
		this.#lang = lang;
		this.#rel_host = rel_host;
		this.#import_keys = import_keys;
		this.#imports = imports;
		this.#imports_to_strip = imports_to_strip;
		this.#export_names = export_names;
		this.#has_island_hint = has_island_hint;
		return null;
	}

	#lower() {
		const source = this.#source;
		const id = this.#id;
		const ctx = this.#ctx;
		const ast = this.#ast;
		const instance_body = this.#instance_body;
		const module_body = this.#module_body;
		const lang = this.#lang;
		const rel_host = this.#rel_host;
		const imports = this.#imports;
		const marked_components = this.#marked_components;
		const imports_to_strip = this.#imports_to_strip;
		const export_names = this.#export_names;
		const has_island_children = this.#has_island_children;
		const has_island_hint = this.#has_island_hint;

		const s = new MagicString(source);
		for (const edit of this.#to_kit) s.overwrite(edit.start, edit.end, edit.text);
		const origin = typeof ctx.originOf === 'function' ? ctx.originOf(id) || id : id;
		const islands_by_id = new Map();
		const salt = ctx.idSalt || '';
		const wrapperPathFor =
			typeof ctx.wrapperPathFor === 'function'
				? ctx.wrapperPathFor
				: (_host: string, iid: string) => wrapperVirtualId(iid);

		const link_virtual = ctx.linkVirtualIsland !== false;
		const binding_stub =
			typeof ctx.clientBindingStub === 'string' && ctx.clientBindingStub
				? ctx.clientBindingStub
				: CLIENT_BINDING_STUB;

		const rewritten_import_nodes = new Set();
		const node_rewrites = new Map<{ start: number; end: number }, string[]>();
		const rewrite_binding = (node: { start: number; end: number }, text: string) => {
			const lines = node_rewrites.get(node);
			if (lines) lines.push(text);
			else node_rewrites.set(node, [text]);
		};
		const fouc_css_specs = new Set();

		const binding_rewrite = (
			local: string,
			bindingPath: string,
			componentPathAbs: string,
			always_link_css = false
		) => {
			let text = `import ${local} from ${JSON.stringify(bindingPath)};`;
			if (
				!ctx.ssr &&
				(always_link_css || (!link_virtual && ctx.dev)) &&
				typeof componentPathAbs === 'string' &&
				componentPathAbs &&
				path.isAbsolute(componentPathAbs) &&
				!fouc_css_specs.has(componentPathAbs)
			) {
				fouc_css_specs.add(componentPathAbs);
				const rel = this.#posix_rel(componentPathAbs);
				text = `${text}\nimport ${JSON.stringify(foucCssVirtualId(rel))};`;
			}
			return text;
		};

		const host_declared = new Set<string>();
		const declare = (node: SvelteNode) => {
			if (node?.type === 'VariableDeclaration')
				for (const d of node.declarations) pattern_names(d.id, host_declared);
			else if (node?.type === 'FunctionDeclaration' || node?.type === 'ClassDeclaration') {
				if (node.id?.name) host_declared.add(node.id.name);
			} else if (node?.type === 'ExportNamedDeclaration') declare(node.declaration);
			else if (node?.type === 'LabeledStatement' && node.label?.name === '$') {
				const e = node.body?.type === 'ExpressionStatement' ? node.body.expression : null;
				if (e?.type === 'AssignmentExpression') pattern_names(e.left, host_declared);
			}
		};
		for (const node of instance_body) declare(node);
		for (const node of module_body) declare(node);
		const module_imports = new Map<string, string>();
		for (const node of module_body) {
			if (node.type !== 'ImportDeclaration') continue;
			const cleaned = clean_import_text(source, node);
			for (const spec of node.specifiers) module_imports.set(spec.local.name, cleaned);
		}

		const store_like = new Set<string>();
		for (const node of instance_body) {
			if (node.type !== 'VariableDeclaration') continue;
			for (const d of node.declarations) {
				const callee = d.init?.type === 'CallExpression' ? d.init.callee : null;
				const cname = callee?.type === 'Identifier' ? callee.name : null;
				if (cname && STORE_CTORS.has(cname) && d.id?.type === 'Identifier')
					store_like.add(d.id.name);
			}
		}
		STORE_SUB_RE.lastIndex = 0;
		for (let m; (m = STORE_SUB_RE.exec(source));) {
			if (source.charCodeAt(m.index - 1) === 36) continue;
			if (!RUNE_NAMES.has(m[1])) store_like.add(m[1]);
		}

		for (const [local, mark] of marked_components) {
			const info = imports.get(local);
			if (!info) continue;

			if (!this.#marked_import_referenced(local)) {
				// Unused marked import — strip entirely (dead code).
				if (!rewritten_import_nodes.has(info.node)) {
					imports_to_strip.add(info.node);
				}
				continue;
			}

			const entry_spec = info.node.source?.value;
			const componentPath = resolve_component_path(entry_spec, origin, ctx);
			if (!componentPath) {
				throw new OgygiaError('region_import_no_specifier', {
					host: rel_host,
					name: local,
					held: false
				});
			}
			// A named import's export is what the generators pull (entry/wrapper import `{ Name as … }`),
			// and identity keys on `source#exportName`; a default import pulls the default (undefined).
			const named_export = export_names.get(local);
			const exportName = named_export === 'default' ? undefined : named_export;
			const comp_rel = this.#component_identity(componentPath);
			const id_base = exportName ? `${comp_rel}#${exportName}` : comp_rel;
			const identity = regionIdentity(id_base, mark);
			const iid = regionId(identity, salt);
			const entryPath = ctx.virtualPathFor(id, iid);
			const wrapPath = wrapperPathFor(id, iid);
			const bindingPath = link_virtual ? wrapPath : binding_stub;

			if (mark.strategy === 'lake') {
				if (!islands_by_id.has(iid)) {
					const remount = mark.options?.remount || 'cache';
					const swr = remount === 'swr';
					islands_by_id.set(iid, {
						id: iid,
						// SWR lakes need a server-renderable entry; cache/empty are wrapper-only.
						virtualPath: swr ? entryPath : undefined,
						source: swr ? island_entry_source(componentPath, iid, exportName) : undefined,
						wrapperPath: wrapPath,
						wrapperSource: lake_wrapper_source(iid, componentPath, mark.options, exportName),
						hostPath: origin,
						componentPath,
						server: swr,
						kind: 'lake',
						lakes: ['OgygiaLakeInner'],
						identity
					});
				}
				// A lake's inner is client-stubbed on every client leg, so its CSS never rides the
				// binding — always link it (see binding_rewrite).
				rewrite_binding(info.node, binding_rewrite(local, bindingPath, componentPath, true));
				continue;
			}

			// HELD region (`region: 'raw'`): a marked import handed to `region()`, never placed. Its binding
			// becomes a metadata descriptor `region()` reads to mint a signed capability (SSR leg carries the
			// signer; the client leg is metadata-only, so no server code reaches the browser). It bakes no
			// schedule — the `region()` call sets it (via its `(data) => options` arg). In a `.svelte` host a
			// `wake:` mark is always a WRAPPER (placed directly or via a portable binding); to bake a schedule
			// on a held region, mark it in the `.ts` registry / remote where it lives (see transformTsRegions).
			if (mark.strategy === 'held') {
				if (!islands_by_id.has(iid)) {
					islands_by_id.set(
						iid,
						make_region_binding({
							iid,
							componentPath,
							entryPath,
							hostPath: origin,
							moduleUrl: ctx.dev ? ctx.devUrlFor(entryPath) : islandPublicUrl(iid, ctx.appDir),
							exportName,
							identity
						})
					);
				}
				rewrite_binding(
					info.node,
					`import ${local} from ${JSON.stringify(regionBindingVirtualId(iid))};`
				);
				continue;
			}

			const is_server = mark.strategy === 'server';
			const deferred_hydrate = is_server && !!mark.options?.hydrate;
			// A `wake` island is ALSO holdable: its binding attaches a descriptor onto the wrapper so
			// `region(C)` respects the baked wake (and portable/dynamic `<C/>` still renders it). Server
			// (deferred) and lake islands are placement-only. The attach binding is the leg-split module the
			// host imports (SSR carries the signer; client is metadata) — see `wrapper_attach_binding`.
			// A `wake` island is ALSO holdable: its binding attaches the descriptor onto the wrapper so
			// `region(C)` respects the baked wake AND `<C/>` renders it. Server (deferred) islands are
			// placement-only. The wake record — mountable + holdable — is minted by the ONE shared emitter
			// `make_wake_island`, so a `.svelte` and a `.ts` `wake:` are byte-identical.
			const wants_attach = !is_server;
			if (!islands_by_id.has(iid)) {
				islands_by_id.set(
					iid,
					is_server
						? {
								id: iid,
								virtualPath: entryPath,
								wrapperPath: wrapPath,
								wrapperSource: server_wrapper_source(
									iid,
									componentPath,
									entryPath,
									mark.options,
									exportName,
									ctx.dev ? ctx.devUrlFor(entryPath) : islandPublicUrl(iid, ctx.appDir)
								),
								// a hole ships no JS: its client leg adopts server HTML (deferred or frozen)
								// and never needs the component
								wrapperClientSource: server_wrapper_source(
									iid,
									componentPath,
									entryPath,
									mark.options,
									exportName,
									ctx.dev ? ctx.devUrlFor(entryPath) : islandPublicUrl(iid, ctx.appDir),
									false
								),
								source: island_entry_source(componentPath, iid, exportName),
								hostPath: origin,
								componentPath,
								server: true,
								kind: deferred_hydrate ? 'hydrate' : 'defer',
								lakes: [],
								identity,
								strategy: mark.strategy,
								fetchWhen: mark.options?.when,
								wakeAfter: deferred_hydrate ? mark.options?.hydrate : undefined,
								keep: mark.options?.keep
							}
						: make_wake_island({
								iid,
								componentPath,
								entryPath,
								wrapperPath: wrapPath,
								moduleUrl: ctx.dev ? ctx.devUrlFor(entryPath) : islandPublicUrl(iid, ctx.appDir),
								strategy: mark.strategy,
								options: mark.options,
								exportName,
								hostPath: origin,
								identity
							})
				);
			}

			// SSR / csr=true client: import the attach binding (wake) or the bare wrapper (server/lake).
			// csr=false client: the stub (binding_rewrite handles that — link_virtual is false there).
			const rewrite_path = wants_attach && link_virtual ? regionBindingVirtualId(iid) : bindingPath;
			rewrite_binding(info.node, binding_rewrite(local, rewrite_path, componentPath));
		}

		// one marked declaration → one binding import per name the file uses, in specifier order
		for (const [node, lines] of node_rewrites) {
			s.overwrite(node.start, node.end, lines.join('\n'));
			rewritten_import_nodes.add(node);
		}

		for (const node of imports_to_strip) {
			if (rewritten_import_nodes.has(node)) continue;
			s.remove(node.start, node.end);
		}

		// ── Portable snippets — the compiler's ONE snippet job: LIVE-branding ───────────────────────
		// A named `{#snippet}` handed to a component that may carry it across an island boundary — a
		// PLAIN component (which may forward it into an island) or a hydrate ISLAND call site directly —
		// can't cross as a function. Compile its body into a standalone island ENTRY and rewrite it to
		// `og_portable(Entry, captures, url)` (see region-snippet.ts): it renders inline in the same graph
		// AND carries a serializable descriptor, so the crossing swaps in the descriptor and the client
		// side comes ALIVE. Parameterized snippets cross too — call-time args ride the descriptor's
		// `__ogArgs` prop. Server/held/lake call sites are excluded (their children can't cross at all);
		// snippets nested inside another portable snippet ship in the outer entry and are re-processed
		// when THAT entry is transformed. Everything else (default children, bare content) is the
		// runtime's job: static freeze or slot adoption.
		const OG_PORTABLE = '__og_portable';
		const portable_candidates: Array<{ comp: { start: number; name: string }; snip: SvelteNode }> =
			[];
		// SCOPE (load-bearing): branding a snippet at its definition site makes every render of it an
		// ISOLATED app — `getContext` inside the body can no longer see the surrounding tree. So brand
		// ONLY where crossing is genuinely required, never where plain Svelte semantics must hold:
		//  - a PLAIN component site takes 0-ARG snippets only (the may-be-forwarded-into-an-island case;
		//    parameterized snippets there are internal wiring — think Bits UI passing `{#snippet x(props)}`
		//    between its own context-coupled components — and MUST stay native);
		//  - a hydrate-ISLAND call site takes ANY arity (without branding the snippet would freeze wrong);
		//  - LIBRARY code (node_modules, swept into the transform by the island-graph seam) is never
		//    branded at all — its snippets were authored against plain Svelte.
		const portable_allowed = !id.includes('node_modules');
		const walk_portable = (nodes: SvelteNode[]) => {
			for (const node of nodes ?? []) {
				if (is_component_node(node)) {
					const base_name = String(node.name || '').split('.')[0];
					const mark = marked_components.get(base_name);
					const island_site = !!mark && !['lake', 'server', 'held'].includes(mark.strategy);
					// GENERATED-OUTPUT GUARD (load-bearing): a component imported from one of ogygia's own
					// virtuals (the client-binding stub, a wrapper/island/region module) means this source
					// is ALREADY-TRANSFORMED output — its mark was consumed, so it reads as "plain" here.
					// Branding its snippets would mint a PHANTOM portable island whose registration wipes
					// the host's real wrapper entries (the csr=false server-island prerender crash). A
					// re-transform of generated output must never widen the island set.
					const import_spec = String(imports.get(base_name)?.node?.source?.value ?? '');
					const from_generated = import_spec.startsWith(OGYGIA_SCHEME);
					for (const child of node.fragment?.nodes ?? []) {
						if (child.type !== 'SnippetBlock' || !child.expression?.name) continue;
						const zero_arg = (child.parameters?.length ?? 0) === 0;
						if (island_site || (!mark && zero_arg && !from_generated)) {
							portable_candidates.push({ comp: node, snip: child });
						}
					}
				}
				for (const k of CHILD_KEYS) if (node[k]?.nodes) walk_portable(node[k].nodes);
			}
		};
		if (portable_allowed) walk_portable(ast.fragment?.nodes ?? []);

		// Drop snippets nested inside another candidate's body — that content ships in the outer entry and
		// is re-processed when the entry `.svelte` is transformed, so converting it here would double-edit.
		// One sweep, not every pair: in start order (ties: the longer first) a candidate sits inside
		// another exactly when the furthest end reached before it covers its end, or a twin shares its span.
		const by_start = [...portable_candidates].sort(outer_spans_first);
		const nested = new Set<(typeof portable_candidates)[number]>();
		let reach = -Infinity;
		for (let i = 0; i < by_start.length; i++) {
			const c = by_start[i];
			const twin = by_start[i + 1];
			if (
				c.snip.end <= reach ||
				(twin && twin.snip.start === c.snip.start && twin.snip.end === c.snip.end)
			)
				nested.add(c);
			if (c.snip.end > reach) reach = c.snip.end;
		}
		const outer_candidates = portable_candidates.filter((c) => !nested.has(c));

		// BLOCK-BOUND names: what a template block declares — `{#each}` items and indexes, `{:then}` /
		// `{:catch}` values, `{@const}`, snippet parameters, and snippets declared below the root. A
		// snippet body that reads one of these lives in that block's scope: it can neither move to the
		// template root (below) nor cross (its entry would see an undefined name), so it stays native.
		const block_bound = new Set<string>();
		// the names a pattern binds, never what its defaults read (test/free-vars-patterns.test.ts)
		const bind_pattern = (n: SvelteNode | SvelteNode[] | null | undefined) => {
			if (Array.isArray(n)) for (const p of n) pattern_names(p, block_bound);
			else pattern_names(n, block_bound);
		};
		const walk_bound = (nodes: SvelteNode[], root: boolean) => {
			for (const node of nodes ?? []) {
				if (node.type === 'EachBlock') {
					bind_pattern(node.context);
					if (node.index) block_bound.add(node.index);
				} else if (node.type === 'AwaitBlock') {
					bind_pattern(node.value);
					bind_pattern(node.error);
				} else if (node.type === 'ConstTag') {
					bind_pattern(node.declaration?.declarations?.map((d: SvelteNode) => d.id));
				} else if (node.type === 'SnippetBlock') {
					bind_pattern(node.parameters);
					if (!root && node.expression?.name) block_bound.add(node.expression.name);
				}
				// a legacy slot prop (`let:item`, `let:item={{ id }}`) binds its children's scope
				for (const a of node.attributes ?? []) {
					if (a.type !== 'LetDirective') continue;
					if (a.expression) bind_pattern(a.expression);
					else if (a.name) block_bound.add(a.name);
				}
				for (const k of CHILD_KEYS) if (node[k]?.nodes) walk_bound(node[k].nodes, false);
			}
		};
		walk_bound(ast.fragment?.nodes ?? [], true);

		// ROOT snippets: declared at the template root, hoisted, in scope everywhere in the host. A live
		// body that renders one (`{@render banner('top')}`) carries it into its synth — it is neither an
		// import nor a capture, and left out it was taken for a global (`ReferenceError` at render).
		const root_snippets = new Map<string, SvelteNode>();
		for (const n of ast.fragment?.nodes ?? [])
			if (n.type === 'SnippetBlock' && n.expression?.name) root_snippets.set(n.expression.name, n);

		let portable_emitted = false;
		const portable_imports: string[] = [];
		const portable_seen = new Set<string>();
		let native_seq = 0;
		// The host's <style> travels into every portable-snippet synth. A snippet body is authored in
		// the host and, in plain Svelte, wears the host's scope class so the host's scoped rules match
		// it. Lifted into its own entry, the body would compile with no <style> and so NO scope class,
		// and the CSS authored for it (`.width-100 { … }`) would match nothing — silently, in prod too.
		// Copying the host <style> in makes the synth self-consistent: Svelte scopes the body and keeps
		// exactly the rules the body uses (the rest prune away), under one hash the body carries. The
		// synth is its own compilation unit, so its hash need not equal the host's — only the body and
		// the rules that style it must share one, which co-locating them here guarantees.
		const host_style_src = ast.css ? source.slice(ast.css.start, ast.css.end) : '';
		for (const { comp, snip } of outer_candidates) {
			const name = snip.expression.name;
			const body = snip.body?.nodes ?? [];
			if (!body.length) continue;
			// Snippet PARAMETERS are call-time inputs, not captures: the entry receives them as an
			// `__ogArgs` prop (region-snippet.ts threads call args into it) and re-binds them verbatim.
			const snip_params = snip.parameters ?? [];
			const params_src = snip_params.length
				? source.slice(snip_params[0].start, snip_params[snip_params.length - 1].end)
				: '';
			const param_names = new Set<string>();
			for (const p of snip_params) pattern_names(p, param_names);
			const { free, mutated, stores } = collectCaptureInfo([snip]);
			// A body bound to an enclosing block's names stays a plain snippet (see block_bound).
			if ([...free].some((nm) => block_bound.has(nm) && !param_names.has(nm))) continue;
			// Only a HOST-state write disqualifies branding (a captured snapshot can't write back). A snippet
			// mutating its OWN parameter is fine — params ride `__ogArgs`, not a capture — so exclude them,
			// exactly as the `free` loop below does. Otherwise a snippet that only reassigns its own param was
			// wrongly left native and failed to cross as a region.
			if ([...mutated].some((m) => !param_names.has(m))) continue;
			// The root snippets the body renders, and those they render: copied into the synth whole, their
			// own free names joining the body's (imports re-imported, host values captured). One that writes
			// host state or reads a `$store` can't come along (the rewrites below cover the body only), so
			// the body stays native.
			const carried: SvelteNode[] = [];
			const pending = [...free].filter((nm) => root_snippets.has(nm) && !param_names.has(nm));
			const carried_names = new Set<string>();
			let carry_blocked = false;
			while (pending.length && !carry_blocked) {
				const nm = pending.pop()!;
				if (carried_names.has(nm)) continue;
				carried_names.add(nm);
				const node = root_snippets.get(nm)!;
				const info = collectCaptureInfo([node]);
				if (info.mutated.size || info.stores.size) carry_blocked = true;
				carried.push(node);
				for (const f of info.free) {
					if (root_snippets.has(f)) pending.push(f);
					else free.add(f);
				}
			}
			if (carry_blocked) continue;
			for (const nm of carried_names) free.delete(nm);
			// Store auto-subscriptions (`$country`) read in the body: the `$` sugar is HOST-scoped.
			// Re-emitted verbatim it names an out-of-scope `$`-identifier in the runes-mode synth
			// ("illegal variable name" pointing at generated code). Capture the subscription VALUE
			// instead — the same snapshot law as every other capture: evaluate `$store` at the host,
			// where it is legal, and rewrite the body's occurrences to the capture's prop name.
			// ALWAYS warn with a trace: in native Svelte `$store` is live; across a boundary it is a
			// render-time snapshot — and when the base can't even be verified as a store, say that too.
			const store_captures: Array<{ prop: string; expr: string }> = [];
			const store_rewrites: Array<{ start: number; end: number; prop: string }> = [];
			for (const [nm, sites] of stores) {
				if (nm.startsWith('$$')) {
					throw new OgygiaError('snippet_reads_dollar_props', {
						host: rel_host,
						snippet: name,
						name: nm
					});
				}
				const base = nm.slice(1);
				const prop = `__og_sub_${base}`;
				store_captures.push({ prop, expr: nm });
				for (const p of sites) store_rewrites.push({ start: p.start, end: p.end, prop });
				const trace = sites.map((p) => `${rel_host}:${line_col(source, p.start)}`).join(', ');
				if (host_declared.has(base) || imports.has(base)) {
					warn_once(`${id}\0${name}\0${nm}\0frozen`, () =>
						warn('snippet_store_snapshot', { host: rel_host, snippet: name, store: nm, at: trace })
					);
				} else {
					warn_once(`${id}\0${name}\0${nm}\0unresolved`, () =>
						warn('snippet_store_unverified', {
							host: rel_host,
							snippet: name,
							store: nm,
							at: trace
						})
					);
				}
			}
			const cleaned_imports: string[] = [];
			const seen_imports = new Set<string>();
			const captures: string[] = [];
			for (const nm of free) {
				if (nm.startsWith('$')) continue; // store subscription — captured by VALUE above
				if (param_names.has(nm)) continue; // a snippet param — rides __ogArgs, never a capture
				if (imports.has(nm)) {
					// An ISLAND placement inside the snippet body must stay an island inside the entry: emit
					// the ORIGINAL import (keeping its `with { wake: … }` attributes) so the entry's own
					// transform pass re-marks it and rewrites the placement into a region. A cleaned import
					// here silently demoted the island to a plain component (no region, no JS, and a
					// top-level await inside it crashed the sync snippet render).
					const info = imports.get(nm)!;
					const text = marked_components.has(nm)
						? source.slice(info.node.start, info.node.end).trim()
						: info.cleaned.trim();
					// Several captured names can resolve to the SAME statement (`{ a, b, c } from './x'`);
					// that one statement already declares all of them, so emit it ONCE. Pushing it per name
					// redeclares the identifiers in the synth ("already been declared" build error).
					if (!seen_imports.has(text)) {
						seen_imports.add(text);
						cleaned_imports.push(text);
					}
				} else if (host_declared.has(nm)) {
					// A host-declared STORE captured as an OBJECT: devalue can't serialize its functions —
					// the island gets a runtime error or a dead copy. Warn with the fix; never gate.
					if (store_like.has(nm)) {
						warn_once(`${id}\0${name}\0${nm}\0object`, () =>
							warn('snippet_captures_store', { host: rel_host, snippet: name, store: nm })
						);
					}
					captures.push(nm);
				} else if (module_imports.has(nm)) {
					const text = module_imports.get(nm)!.trim();
					if (!seen_imports.has(text)) {
						seen_imports.add(text);
						cleaned_imports.push(text);
					}
				}
				// else: a global — referenced directly in the entry, needs no wiring.
			}
			// Body markup, with each `$store` read span rewritten to its capture prop. The rewritten
			// text fully determines the store captures (prop names are derived from the spans), so the
			// identity hash below needs no extra segment for them.
			const body_start = body[0].start;
			const body_end = body[body.length - 1].end;
			let markup: string;
			if (store_rewrites.length) {
				store_rewrites.sort((a, b) => a.start - b.start);
				let out = '';
				let cursor = body_start;
				for (const r of store_rewrites) {
					out += source.slice(cursor, r.start) + r.prop;
					cursor = r.end;
				}
				markup = out + source.slice(cursor, body_end);
			} else {
				markup = source.slice(body_start, body_end);
			}
			// (template-root snippets are hoisted: their order in the synth does not matter)
			const carried_src = carried.map((n) => source.slice(n.start, n.end)).join('\n');
			const hash = createHash('md5')
				.update(
					`${markup}\0${captures.join(',')}\0${cleaned_imports.join('\n')}\0${params_src}\0${carried_src}`
				)
				.digest('hex')
				.slice(0, 12);
			// host identity via #component_identity: a declared-package host keys `<pkg>/<rel>`
			// (install-independent), everything else stays root-relative — same rule as components.
			const identity = regionIdentity(`${this.#component_identity(this.#id)}\0psnip:${hash}`, {
				strategy: 'hydrate'
			});
			const iid = regionId(identity, salt);
			const entryPath = ctx.virtualPathFor(id, iid).replace(JS_EXT, '.svelte');
			if (!islands_by_id.has(iid)) {
				const store_props = store_captures.map((c) => c.prop);
				const prop_names = snip_params.length
					? ['__ogArgs = []', ...captures, ...store_props]
					: [...captures, ...store_props];
				// The body is written at the entry's template root. A `{@const}` is legal directly under
				// `{#snippet}` but not at a template root (`const_tag_invalid_placement`, a build error
				// on a customer page), so a body that opens with one keeps its snippet around it — the
				// same scope it was authored in, rendered once.
				const wrapped = body.some((n: SvelteNode) => n.type === 'ConstTag');
				const template =
					(carried_src ? `${carried_src}\n` : '') +
					(wrapped
						? dedent`
							{#snippet __og_body()}
							${markup}
							{/snippet}
							{@render __og_body()}
						`
						: markup);
				const import_lines = cleaned_imports.map((imp) => `\t${imp}\n`).join('');
				const props = prop_names.length
					? `\t// svelte-ignore state_referenced_locally\n\tlet { ${prop_names.join(', ')} } = $props();\n`
					: '';
				const args = snip_params.length
					? `\t// svelte-ignore state_referenced_locally\n\tconst [${params_src}] = __ogArgs;\n`
					: '';
				const host_style = host_style_src ? `${host_style_src}\n` : '';
				const synth = `<script${lang}>
	import 'ogygia:region/transportables-eager';
${import_lines}${props}${args}</script>
${template}
${host_style}`;
				islands_by_id.set(iid, {
					id: iid,
					virtualPath: entryPath,
					wrapperPath: wrapperPathFor(id, iid),
					wrapperSource: '',
					source: synth,
					hostPath: origin,
					componentPath: entryPath,
					server: false,
					kind: 'hydrate',
					lakes: [],
					identity,
					strategy: 'hydrate',
					portable: true
				});
			}
			const url = ctx.dev ? ctx.devUrlFor(entryPath) : islandPublicUrl(iid, ctx.appDir);
			const cap_entries = [...captures, ...store_captures.map((c) => `${c.prop}: ${c.expr}`)];
			const cap_obj = cap_entries.length ? `{ ${cap_entries.join(', ')} }` : '{}';
			// SSR renders the entry inline (static import); the csr=false client loads it by url on wake.
			// Two identical snippets dedupe to one iid → import/preload each entry ONCE (else a duplicate
			// `__OgPS_<iid>` declaration).
			const entry_ref = ctx.ssr ? `__OgPS_${iid}` : 'null';
			if (!portable_seen.has(iid)) {
				portable_seen.add(iid);
				if (ctx.ssr)
					portable_imports.push(`import __OgPS_${iid} from ${JSON.stringify(entryPath)};`);
				// (No static <head> modulepreload here — that preloaded every portable CANDIDATE in the
				// host, rendered or not. The no-waterfall hint is emitted RENDER-GATED by Region.svelte
				// instead: an island whose props carry a portable descriptor preloads its entry + deps
				// alongside its own facade, so only snippets that actually cross a rendered boundary
				// cost a fetch.)
			}
			// The snippet AS WRITTEN stays: it moves to the template root under a private name (its body
			// reads only host-level names — block-bound bodies were skipped above — so the root is the same
			// scope) and keeps rendering IN PLACE wherever the component renders it: the host's context,
			// its scoped CSS, an island inside it a plain page island. The component receives it branded
			// (`og_portable`), carrying the descriptor and the portable entry that only a boundary swaps in
			// (portable-form.ts). Moving (not copying) keeps every edit this pass already made inside the
			// body. Root, not beside the component: a snippet declared inside ANOTHER component's children
			// would become a prop of that component.
			const native_name = `__og_native_${name}_${native_seq++}`;
			s.move(snip.start, snip.end, source.length);
			s.overwrite(snip.expression.start, snip.expression.end, native_name);
			const insert_at = comp.start + 1 + String(comp.name).length;
			s.appendLeft(
				insert_at,
				` ${name}={${OG_PORTABLE}(${native_name}, ${entry_ref}, ${cap_obj}, ${JSON.stringify(url)})}`
			);
			portable_emitted = true;
		}

		// Instance-script head: the portable helper import. One combined injection so a script-less
		// host gains exactly ONE synthesized <script>.
		{
			let head = '';
			if (portable_emitted) {
				const helper = `import { og_portable as ${OG_PORTABLE} } from 'ogygia/internal';`;
				head = `${head}${[helper, ...portable_imports].join('\n')}\n`;
			}
			if (head) {
				if (ast.instance) s.appendLeft(ast.instance.content.start, `\n${head}`);
				else
					s.prepend(
						`${dedent`
					<script${lang}>
					${head}</script>
				`}\n`
					);
			}
		}

		// Snippet-only files that produced no island or portable work are untouched — behave as bailed.
		if (
			!has_island_hint &&
			!portable_emitted &&
			islands_by_id.size === 0 &&
			this.#to_kit.length === 0
		)
			return null;

		// THE one wire question a host compilation answers: can this host cross live content into an
		// island? True for a static placement WITH children (they cross as slot pointers), for a
		// portable `{#snippet}` synth (a live snippet crossing), and for a hydrate binding with NO
		// static placement — a value used dynamically (registry export, each/`svelte:component`,
		// prop hand-off) whose placement sites are compile-invisible, so crossing can't be ruled out.
		// program.register turns this single flag into the runtime `wire` mark; server/held/lake
		// marks never cross children this way and stay out of it.
		const has_dynamic_island_use = [...marked_components].some(
			([name, m]) => is_wake_island(m) && !this.#static_placed.has(name)
		);

		return {
			code: s.toString(),
			map: s.generateMap({ hires: true, source: id, includeContent: true }),
			islands: [...islands_by_id.values()],
			hasWireCrossing: has_island_children || has_dynamic_island_use || portable_emitted
		};
	}
}

/** Span order for the portable-snippet nesting sweep: by start, the longer span first on a tie. */
function outer_spans_first(a: { snip: SvelteNode }, b: { snip: SvelteNode }): number {
	return a.snip.start - b.snip.start || b.snip.end - a.snip.end;
}

/** An import / re-export declaration's attributes (`with { a: 'x', "b": 'y' }`) as a key→value map. */
function import_attrs_of(node: SvelteNode): Map<string, string> {
	const attrs = new Map<string, string>();
	for (const a of node.attributes ?? []) {
		const key = a.key?.type === 'Identifier' ? a.key.name : a.key?.value;
		if (typeof key === 'string' && typeof a.value?.value === 'string')
			attrs.set(key, a.value.value);
	}
	return attrs;
}

/**
 * Rewrite held-region imports in a `.ts` / `.js` module (a load or remote function, where held
 * regions are minted and handed to `region()`). Svelte's `parse()` can't read these files, so this
 * reads the module's oxc AST; only the default-import form is a region import. A `.ts` module has no template,
 * so every marked import here is HELD → a descriptor. Two markers:
 *   - `region: 'raw'` → bakes no schedule (set at the `region()` call).
 *   - `wake: 'x'`     → bakes that schedule (the `region()` call can still override).
 * Each registers a server-manifest entry + client chunk and is rewritten to import the leg-split
 * descriptor module. Returns the same `{code, map, islands}` shape, or `null` when nothing matched.
 *
 * @param source
 * @param id absolute module path
 * @param ctx same context fields as {@link transformHost} (root, libDir, dev, devUrlFor,
 *   virtualPathFor, importKeys, idSalt)
 * @returns
 */
export function transformTsRegions(
	source: string,
	id: string,
	ctx: TsRegionCtx
): { code: string; map: SourceMap; islands: IslandDescriptor[]; hasWireCrossing: boolean } | null {
	return new TsRegionCompilation(source, id, ctx).run();
}

/**
 * `TsRegionCompilation` — the per-file compilation unit for a `.ts`/`.js` region module (a held
 * registry / remote). A `.ts` module has no template, so every mark mints a HELD binding (mountable +
 * crossable) through the SAME emitters the `.svelte` host uses. Ephemeral state lives on `this`;
 * `run()` is the single pass — scan `with { … }` imports and rewrite each name one binds to its
 * binding import. A fresh instance per file, like {@link FileCompilation}.
 */
class TsRegionCompilation {
	#source;
	#id;
	#ctx;
	#import_keys;
	#regionKey;
	#wakeKey;
	#root;
	#salt;
	#rel_host;

	constructor(source: string, id: string, ctx: TsRegionCtx) {
		this.#source = source;
		this.#id = id;
		this.#ctx = ctx;
		this.#import_keys = normalize_import_keys(ctx.importKeys);
		this.#regionKey = this.#import_keys.region;
		this.#wakeKey = this.#import_keys.wake;
		this.#root = ctx.root;
		this.#salt = ctx.idSalt || '';
		this.#rel_host = path.relative(this.#root, id).split(PATH_SEP).join('/');
	}

	/** Root-relative posix path (see FileCompilation#posix_rel). */
	#posix_rel(abs: string) {
		return path.relative(this.#root, abs).split(PATH_SEP).join('/');
	}

	#resolve_spec(spec: string) {
		if (typeof spec !== 'string' || !spec.trim()) return null;
		return resolve_app_spec(spec, this.#id, this.#ctx) ?? spec;
	}

	/** Region-identity path — filesystem components key on their posix path; a package spec is its
	 *  own. Declared-package files key `<pkg-name>/<rel>` (install-independent — see
	 *  FileCompilation#component_identity); duck-typed like wrapperPathFor, host ctxs may lack it. */
	#component_identity(p: string) {
		if (!path.isAbsolute(p)) return p;
		const ctx = this.#ctx;
		const pkg = typeof ctx.pkg_identity === 'function' ? ctx.pkg_identity(p) : null;
		return pkg ?? this.#posix_rel(p);
	}

	#wrapper_path_for(wid: string) {
		const ctx = this.#ctx;
		return typeof ctx.wrapperPathFor === 'function'
			? ctx.wrapperPathFor(this.#id, wid)
			: wrapperVirtualId(wid);
	}

	// The ONE `.ts`/`.js` region emitter — one call per name a marked import binds. A
	// `region: 'raw'` marker → a bare held descriptor; a `wake:` marker → a MOUNTABLE held island (the
	// same `make_wake_island` record the `.svelte` host uses; `held: true` so it also crosses the wire).
	// Its identity stays `held:*` — distinct from a `.svelte` PLACED island (`hydrate:*`, no endpoint).
	// Returns `{ iid, record }` for the caller to register + rewrite. `exportName` is undefined for a
	// default import, the barrel export name for a named one.
	#emit_ts_region(
		componentPath: string,
		marker: { region?: string; wake?: string; render?: string; fetch?: string },
		exportName?: string
	): { iid: string; record: object; importFrom: string } {
		const comp_rel = this.#component_identity(componentPath);
		const id_base = exportName && exportName !== 'default' ? `${comp_rel}#${exportName}` : comp_rel;
		// `render: 'deferred'` (+ `fetch`, its timing) — a SERVER island (a content hole fetched from the
		// endpoint on that timing). Mirrors the `.svelte` deferred path (resolve_region_mark's server
		// block + the inline server record), so a `.svelte` and a `.ts` deferred import are byte-identical.
		// The rewritten import points at the WRAPPER (not a held binding): placed as `<C {...}/>` it emits
		// the hole; its `ogygiaFallback` slot is preserved (the router supplies it). `render: 'live'` stays
		// .svelte-only.
		const fetchKey = this.#import_keys.fetch;
		const renderKey = this.#import_keys.render;
		if (marker.fetch != null && marker.render == null) {
			throw new OgygiaError('held_fetch_without_render', {
				host: this.#rel_host,
				fetch_key: fetchKey,
				render_key: renderKey,
				wake_key: this.#wakeKey,
				value: marker.fetch
			});
		}
		if (marker.render != null) {
			if (marker.render !== 'deferred') {
				throw marker.render === 'live'
					? new OgygiaError('held_render_live', { host: this.#rel_host, render_key: renderKey })
					: new OgygiaError('held_render_unknown', {
							host: this.#rel_host,
							render_key: renderKey,
							value: marker.render
						});
			}
			// the old `wake` timing still times the hole, with a warning naming its replacement (as the
			// `.svelte` path does); both at once is a contradiction
			if (marker.wake != null) {
				if (marker.fetch != null) {
					throw new OgygiaError('held_hole_timed_twice', {
						host: this.#rel_host,
						render_key: renderKey,
						fetch_key: fetchKey,
						wake_key: this.#wakeKey,
						fetch: marker.fetch,
						wake: marker.wake
					});
				}
				const wake = marker.wake;
				warn_once(`deferred-wake:${this.#rel_host}:ts:${wake}`, () =>
					warn('hole_wake_deprecated', {
						host: this.#rel_host,
						render_key: renderKey,
						wake_key: this.#wakeKey,
						fetch_key: fetchKey,
						value: wake
					})
				);
			}
			const dval = marker.fetch ?? marker.wake ?? 'load';
			let when: string;
			if (parse_trigger(dval, WAKE)) when = dval;
			else
				throw new OgygiaError('held_fetch_not_timing', {
					host: this.#rel_host,
					fetch_key: fetchKey,
					value: dval
				});
			const options: { when: string; margin?: string } = { when };
			if (when === 'visible' && this.#ctx.visibleMargin != null)
				options.margin = this.#ctx.visibleMargin;
			const identity = regionIdentity(id_base, { strategy: 'server', options });
			const iid = regionId(identity, this.#salt);
			const entryPath = this.#ctx.virtualPathFor(this.#id, iid);
			const wrapPath = this.#wrapper_path_for(iid);
			return {
				iid,
				importFrom: wrapPath, // placed as `<C/>`, the wrapper emits the deferred hole
				record: {
					id: iid,
					virtualPath: entryPath,
					wrapperPath: wrapPath,
					wrapperSource: server_wrapper_source(
						iid,
						componentPath,
						entryPath,
						options,
						exportName,
						this.#ctx.dev ? this.#ctx.devUrlFor(entryPath) : islandPublicUrl(iid, this.#ctx.appDir)
					),
					// (a hole ships no JS — see the placed-hole record)
					wrapperClientSource: server_wrapper_source(
						iid,
						componentPath,
						entryPath,
						options,
						exportName,
						this.#ctx.dev ? this.#ctx.devUrlFor(entryPath) : islandPublicUrl(iid, this.#ctx.appDir),
						false
					),
					source: island_entry_source(componentPath, iid, exportName),
					hostPath: this.#id,
					componentPath,
					server: true,
					kind: 'defer',
					lakes: [],
					identity,
					strategy: 'server',
					fetchWhen: options.when
				}
			};
		}
		if (marker.region != null) {
			normalize_region_value(marker.region, this.#rel_host, this.#regionKey);
			const identity = regionIdentity(id_base, { strategy: 'held', options: {} });
			const iid = regionId(identity, this.#salt);
			const entryPath = this.#ctx.virtualPathFor(this.#id, iid);
			return {
				iid,
				importFrom: regionBindingVirtualId(iid),
				record: make_region_binding({
					iid,
					componentPath,
					entryPath,
					hostPath: this.#id,
					moduleUrl: this.#ctx.dev
						? this.#ctx.devUrlFor(entryPath)
						: islandPublicUrl(iid, this.#ctx.appDir),
					exportName,
					identity
				})
			};
		}
		const strategy = normalize_hydrate_value(marker.wake as string, this.#rel_host, this.#wakeKey);
		const hydrateMargin =
			strategy === 'visible' && this.#ctx.visibleMargin != null
				? this.#ctx.visibleMargin
				: undefined;
		const identity = regionIdentity(id_base, {
			strategy: 'held',
			options: hydrateMargin ? { hydrate: strategy, hydrateMargin } : { hydrate: strategy }
		});
		const iid = regionId(identity, this.#salt);
		const entryPath = this.#ctx.virtualPathFor(this.#id, iid);
		return {
			iid,
			importFrom: regionBindingVirtualId(iid),
			record: make_wake_island({
				iid,
				componentPath,
				entryPath,
				wrapperPath: this.#wrapper_path_for(iid),
				moduleUrl: this.#ctx.dev
					? this.#ctx.devUrlFor(entryPath)
					: islandPublicUrl(iid, this.#ctx.appDir),
				strategy,
				options: hydrateMargin ? { margin: hydrateMargin } : {},
				hostPath: this.#id,
				identity,
				held: true,
				exportName
			})
		};
	}

	run() {
		const source = this.#source;
		const id = this.#id;
		const import_keys = this.#import_keys;
		const regionKey = this.#regionKey;
		const wakeKey = this.#wakeKey;
		const renderKey = import_keys.render;
		const fetchKey = import_keys.fetch;
		// cheap bail — a region key in an attribute bag (`with`, or a dynamic import's legacy `assert`,
		// which is refused below) OR the retired `import.meta.og.asRegion(…)` (refused below).
		if (
			!source.includes('asRegion') &&
			(!import_keys_hint(import_keys).test(source) ||
				(!source.includes('with') && !source.includes('assert')))
		)
			return null;

		const rel_host = this.#rel_host;

		const s = new MagicString(source);
		const islands_by_id = new Map();
		let matched = false;
		// The one AST of this module. A module that does not parse is left to the bundler, which names
		// the syntax error; an import that is only text (a string, a template, a comment) is never a
		// statement here (test: ts-region-imports.test.ts).
		const { program, ok } = parse_module(source, id);
		if (!ok || !program) return null;
		const body = (program.body ?? []) as SvelteNode[];
		// a dynamic import() with a region key is refused, as in a host
		reject_dynamic_region_imports(body, import_keys, rel_host);
		refuse_as_region(body, source, rel_host);
		const marked = new Map<string, { node: SvelteNode; exportName: string }>();
		for (const node of body) {
			if (
				node.type !== 'ImportDeclaration' &&
				node.type !== 'ExportNamedDeclaration' &&
				node.type !== 'ExportAllDeclaration'
			)
				continue;
			const attrs = import_attrs_of(node);
			const has_render = attrs.has(renderKey);
			const has_region = attrs.has(regionKey);
			const has_wake = attrs.has(wakeKey);
			const has_fetch = attrs.has(fetchKey);
			if (!has_render && !has_region && !has_wake && !has_fetch) continue;
			// a re-export carries no binding of this module's own to make a region
			if (node.type !== 'ImportDeclaration')
				throw new OgygiaError('region_import_invalid', {
					host: rel_host,
					names:
						(node.specifiers ?? [])
							.map((sp: SvelteNode) => (sp.exported ?? sp.local)?.name)
							.filter(Boolean)
							.join(', ') || String(node.source?.value ?? '?'),
					problem: `a re-export cannot carry a region mark. Import it with the mark, then export the binding: \`import { X } from '…' with { … }; export { X };\``
				});
			// every name the declaration binds is a region (a namespace, nothing, a type: refused)
			const bindings = marked_import_bindings(node, source, rel_host);
			const local = bindings.map((b) => b.local).join(', ');
			const spec = String(node.source.value);
			// `region` and a bare `wake` are exclusive; `render: 'deferred'` pairs with `fetch` (its timing).
			// A lone `fetch` and the retired `render` + `wake` reach #emit_ts_region, which names the
			// spelling to write; anything else is a mismatched marker set.
			const bad_combo =
				(has_region && attrs.size > 1) ||
				(has_render &&
					[...attrs.keys()].some((k) => k !== renderKey && k !== wakeKey && k !== fetchKey)) ||
				(!has_render && has_wake && attrs.size > 1);
			if (bad_combo) {
				throw new OgygiaError('held_marker_mixed', {
					host: rel_host,
					name: local,
					region_key: regionKey,
					wake_key: wakeKey,
					render_key: renderKey,
					fetch_key: fetchKey
				});
			}
			const componentPath = this.#resolve_spec(spec);
			if (!componentPath) {
				throw new OgygiaError('region_import_no_specifier', {
					host: rel_host,
					name: local,
					held: true
				});
			}
			const marker = has_render
				? { render: attrs.get(renderKey), wake: attrs.get(wakeKey), fetch: attrs.get(fetchKey) }
				: has_region
					? { region: attrs.get(regionKey) }
					: has_fetch
						? { fetch: attrs.get(fetchKey) }
						: { wake: attrs.get(wakeKey) };
			const lines: string[] = [];
			for (const b of bindings) {
				const { iid, record, importFrom } = this.#emit_ts_region(
					componentPath,
					marker,
					b.exportName === 'default' ? undefined : b.exportName
				);
				if (!islands_by_id.has(iid)) islands_by_id.set(iid, record);
				lines.push(`import ${b.local} from ${JSON.stringify(importFrom)};`);
				marked.set(b.local, { node, exportName: b.exportName });
			}
			s.overwrite(node.start, node.end, lines.join('\n'));
			matched = true;
		}
		// every marked name is a component: handed on as a value, never called or read into
		check_marked_uses(body, marked, source, rel_host);

		if (!matched) return null;
		const islands = [...islands_by_id.values()];
		return {
			code: s.toString(),
			map: s.generateMap({ hires: true, source: id, includeContent: true }),
			islands,
			// A `.ts`/`.js` mint has no markup — every minted WAKE island is a VALUE placed at
			// compile-invisible sites (the registry/factory pattern), so children can cross there and
			// the wire revivers must ship. `strategy` is the discriminator: wake mints carry their wake
			// value; deferred mints say 'server' (isolation — children never cross); raw/held bindings
			// carry none (data-minting); 'none' is a lake (static HTML). Those keep lean apps lean.
			hasWireCrossing: islands.some(
				(i) => typeof i.strategy === 'string' && i.strategy !== 'server' && i.strategy !== 'none'
			)
		};
	}
}
