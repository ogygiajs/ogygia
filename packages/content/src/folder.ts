import {
	numbered,
	read_meta,
	strip_order_prefix,
	title_case,
	type Convention,
	type MetaDecoration
} from './convention.ts';
import { flights, STALE } from '@ogygia/machine';
import { markdown } from './formats.ts';
import { OgygiaError } from './messages/runtime.ts';
import type { GlobMap, RawRecord, RawSource, Source } from './source.ts';

const BACKSLASH = /\\/g;
const norm = (k: string) => k.replace(BACKSLASH, '/').split('?')[0];

export type FolderOptions<Meta> = {
	/** Which keys are pages (become entries). Default: `+doc.svx` / `+doc.md` / `index.*`. */
	page?: RegExp;
	/** Which keys are directory sidecars. Default: `+meta.json`. `false` = no sidecars. */
	meta?: RegExp | false;
	/** The sibling-ordering convention. Default {@link numbered}. */
	convention?: Convention;
	/** The format builder wrapping the page files. Default {@link markdown}. */
	format?: (input: RawSource<unknown>) => Source<Meta>;
};

const DEFAULT_PAGE = /\/(\+doc|index)\.[^./]+$/;
const DEFAULT_META = /\/\+meta\.json$/;

function common_prefix(keys: string[]): string {
	const parts = keys.map(norm);
	let prefix = parts[0] ? parts[0].slice(0, parts[0].lastIndexOf('/') + 1) : '';
	for (const p of parts.slice(1)) {
		while (prefix && !p.startsWith(prefix))
			prefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf('/') + 1);
	}
	return prefix;
}

function unwrap(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const mod = value as Record<string, unknown>;
		const keys = Object.keys(mod).filter((k) => k !== '__esModule');
		if (keys.length === 1 && keys[0] === 'default') return unwrap(mod.default);
		return mod;
	}
	return {};
}

/**
 * The filesystem-convention source: one glob of `+doc.svx` pages and `+meta.json` sidecars in, a
 * full {@link Source} out. Ids drop the shared directory prefix and each segment's `NN-`; each entry
 * carries its sibling `order`; sidecar labels come out of `groups()`. The outline reads `order` and
 * `groups` as data and parses no filename, so a CMS fills the same fields from its own.
 *
 * A file that is neither a page nor a sidecar throws at once (a too-wide glob would bundle colocated
 * components). Sibling numbering is checked, and lazy sidecars load, at the first read. A sidecar
 * pattern wins over a page pattern that also matches, so an `index.md` can label its section with
 * its frontmatter `title`.
 *
 * ```ts
 * content({ loader: folder(import.meta.glob('../content/docs/**\/{+doc.svx,+meta.json}', { eager: true })) })
 * content({ loader: folder(map, { format: (raw) => blocks(raw, registry) }) })   // any format; default markdown
 * ```
 */
export function folder<Meta = Record<string, never>>(
	map: GlobMap,
	opts: FolderOptions<Meta> = {}
): Source<Meta> {
	const page_rx = opts.page ?? DEFAULT_PAGE;
	const meta_rx = opts.meta ?? DEFAULT_META;
	const conv = opts.convention ?? numbered();
	const build = opts.format ?? (markdown as unknown as (input: RawSource<unknown>) => Source<Meta>);

	const prefix = common_prefix(Object.keys(map));
	const rel = (key: string) => norm(key).slice(prefix.length);

	const page_map: GlobMap = {};
	const meta_entries: Array<{ dir: string; value: unknown }> = [];
	const siblings = new Map<string, Set<string>>();

	const raw_segments = (key: string) => {
		const r = rel(key).replace(page_rx, '');
		return r.split('/').filter(Boolean);
	};

	for (const key of Object.keys(map)) {
		const k = norm(key);
		if (meta_rx && meta_rx.test(k)) {
			const dir = rel(key)
				.replace(meta_rx, '')
				.split('/')
				.map(strip_order_prefix)
				.filter(Boolean)
				.join('/');
			meta_entries.push({ dir, value: map[key] });
		} else if (page_rx.test(k)) {
			page_map[key] = map[key];
			const segs = raw_segments(key);
			for (let d = 0; d < segs.length; d++) {
				const parent = segs.slice(0, d).map(strip_order_prefix).join('/');
				(siblings.get(parent) ?? siblings.set(parent, new Set()).get(parent)!).add(segs[d]);
			}
		} else {
			throw new OgygiaError('content_folder_unexpected_file', {
				key,
				page: String(page_rx),
				sidecar: meta_rx ? String(meta_rx) : ''
			});
		}
	}

	const page_id = (key: string) =>
		raw_segments(key)
			.map((s) => conv.segment(s).slug)
			.join('/');
	const page_order = (key: string): number[] => raw_segments(key).map((s) => conv.segment(s).order);

	const resolve_meta = flights({
		name: 'content-folder meta',
		run: async (): Promise<{
			decorations: Map<string, MetaDecoration>;
			group_map: Map<string, { label?: string }>;
		}> => {
			const decorations = new Map<string, MetaDecoration>();
			for (const { dir, value } of meta_entries) {
				const mod = unwrap(
					typeof value === 'function' ? await (value as () => Promise<unknown>)() : value
				);
				const deco = read_meta(mod);
				const fm = (mod as { metadata?: { title?: unknown } }).metadata;
				if (deco.label === undefined && typeof fm?.title === 'string') deco.label = fm.title;
				decorations.set(dir, deco);
			}
			const group_map = new Map<string, { label?: string }>();
			for (const { dir } of meta_entries) {
				const last = dir.split('/').pop() ?? '';
				group_map.set(dir, { label: decorations.get(dir)?.label ?? title_case(last) });
			}
			return { decorations, group_map };
		}
	});
	const meta = async () => {
		const got = await resolve_meta.get();
		return got === STALE
			? { decorations: new Map<string, MetaDecoration>(), group_map: new Map() }
			: got;
	};

	const verify = async () => {
		const { decorations } = await meta();
		const errors: string[] = [];
		for (const [dir, set] of siblings)
			errors.push(...conv.verify(dir, [...set], decorations.get(dir)));
		if (errors.length)
			throw new OgygiaError('content_folder_invalid', { issues: errors.join('; ') });
	};

	const load = async (key: string) => {
		const v = map[key];
		return typeof v === 'function' ? await (v as () => Promise<unknown>)() : v;
	};
	const keys_by_id = new Map<string, string>();
	for (const key of Object.keys(page_map)) {
		const id = page_id(key);
		if (!id) throw new OgygiaError('content_folder_empty_id', { key });
		if (keys_by_id.has(id)) throw new OgygiaError('content_folder_duplicate_id', { id, key });
		keys_by_id.set(id, key);
	}
	const record = async (id: string, key: string): Promise<RawRecord<unknown>> => ({
		id,
		value: await load(key),
		order: page_order(key),
		filePath: norm(key)
	});

	const page_raw: RawSource<unknown> = {
		init: async () => verify(),
		refs: () => Promise.all([...keys_by_id].map(([id, key]) => record(id, key))),
		async get(id) {
			const key = keys_by_id.get(id);
			return key ? record(id, key) : null;
		},
		groups: async () => (await meta()).group_map
	};

	return build(page_raw);
}
