import type { LinkRef } from '../index.ts';
import { href_of, type Outline } from './outline.ts';
import type { ReadContext } from './site.ts';
import { warn } from '../messages/runtime.ts';

/** How loud a finding is: `'error'` fails the build (load throws); `'warn'` logs in dev. */
export type Severity = 'error' | 'warn';

/** One check result — file-anchored where possible, so it reads in the build-error voice. */
export type Finding = {
	/** The check that produced it (its `name`). */
	check: string;
	severity: Severity;
	message: string;
	/** The page it belongs to, when page-scoped. */
	slug?: string;
	/** Source file of the page (from the entry's `filePath`), for editor-jumpable errors. */
	file?: string;
	/** Approximate 1-based line, when the finding carries one (e.g. a link's position). */
	line?: number;
};

/** What a check is handed: the address space + the current read context + the mount base. */
export type CheckContext = { outline: Outline; base: string; ctx: ReadContext };

/**
 * A content check: opt-in policy over the corpus, speaking in {@link Finding}s. `page` runs in
 * `site.load`, so an `'error'` finding fails the page in dev, SSR and prerender alike. `site` runs
 * for `site.check()` and returns the findings as data. A check with only `page` gets a `site` that
 * runs `page` over every address. Structural errors (orphans, slug collisions) are not checks: the
 * outline always raises them.
 */
export type Check = {
	name: string;
	page?: (slug: string, cx: CheckContext) => Finding[] | Promise<Finding[]>;
	site?: (cx: CheckContext) => Finding[] | Promise<Finding[]>;
};

function headings_of(meta: unknown): Array<{ id: string }> {
	if (meta && typeof meta === 'object' && 'headings' in meta) {
		const h = (meta as { headings: unknown }).headings;
		if (Array.isArray(h)) return h as Array<{ id: string }>;
	}
	return [];
}
function links_of(meta: unknown): LinkRef[] {
	if (meta && typeof meta === 'object' && 'links' in meta) {
		const l = (meta as { links: unknown }).links;
		if (Array.isArray(l)) return l as LinkRef[];
	}
	return [];
}
function has_link_data(meta: unknown): boolean {
	// @why `links: []` is link data, a missing `links` is not (test: test/site-checks.test.ts › a page with no links property is warned about once and passes; links: [] is link data)
	return !!meta && typeof meta === 'object' && 'links' in meta;
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const TRAILING_SLASHES_RE = /\/+$/;
const EDGE_SLASHES_G = /^\/+|\/+$/g;

/** Tuning for the {@link links} check — the old `audit` options, now on the value. */
export type LinkOptions = {
	/** Validate `#fragments` against the target page's collected headings (default `true`). */
	anchors?: boolean;
	/** Policy for links that resolve through a declared redirect (they WORK, 308, but are stale):
	 *  `'warn'` (default) logs, `'error'` fails the build, `'ok'` stays silent. */
	redirected?: 'error' | 'warn' | 'ok';
	/** Skip hrefs the check should not judge (generated / intentionally external-ish paths). */
	ignore?: (href: string) => boolean;
};

/**
 * The link audit as a check value. Validates each page's in-prose markdown links (`meta.links`,
 * collected by the markdown format) against the site's own address space — missing pages, missing
 * anchors, and stale redirect links. A blocks/CMS corpus that collects no `meta.links` is warned
 * about once (dev), then passes (any format can fill `meta.links` to opt in).
 *
 *   site({ outline: docs, checks: [links()] })
 *   site({ outline: docs, checks: [links({ anchors: false, redirected: 'error' })] })
 */
export function links(opts: LinkOptions = {}): Check {
	const anchors = opts.anchors ?? true;
	const redirected_policy = opts.redirected ?? 'warn';
	const ignore = opts.ignore;
	const warned = new WeakSet<object>();

	const check_page = async (slug: string, cx: CheckContext): Promise<Finding[]> => {
		const hit = await cx.outline.resolve(slug, cx.ctx);
		if (!hit) return [];
		const entry = await hit.collection.get(hit.record.entryId, cx.ctx);
		if (!has_link_data(entry?.meta)) {
			if (!warned.has(hit.collection)) {
				warned.add(hit.collection);
				if (import.meta.env?.DEV) warn('content_links_no_data', { slug });
			}
			return [];
		}
		const file = hit.record.filePath;
		const findings: Finding[] = [];
		const b = (cx.base || '').replace(TRAILING_SLASHES_RE, '');

		for (const link of links_of(entry?.meta)) {
			const href = link.href;
			if (!href || ignore?.(href)) continue;

			let path: string;
			let frag: string | undefined;
			if (href.startsWith('#')) {
				path = slug;
				frag = href.slice(1);
			} else if (URL_SCHEME.test(href) || href.startsWith('//')) {
				continue;
			} else if (href.startsWith('/')) {
				let rest: string;
				if (b && (href === b || href.startsWith(b + '/'))) rest = href.slice(b.length);
				else if (!b) rest = href;
				else continue;
				const [p, f] = rest.split('#');
				path = p.replace(EDGE_SLASHES_G, '');
				frag = f;
			} else {
				// @why a relative link (a colocated asset) is not judged (test: test/site-checks.test.ts › a relative link (a colocated asset) is not judged)
				continue;
			}

			const at = {
				check: 'links',
				slug,
				...(file ? { file } : {}),
				...(link.line !== undefined ? { line: link.line } : {})
			};
			const hit2 = await cx.outline.resolve(path, cx.ctx);
			if (hit2) {
				if (frag && anchors) {
					const target = await hit2.collection.get(hit2.record.entryId, cx.ctx);
					if (!headings_of(target?.meta).some((h) => h.id === frag)) {
						findings.push({
							...at,
							severity: 'error',
							message: `'${href}': missing anchor #${frag}${link.text ? ` — link text "${link.text}"` : ''}`
						});
					}
				}
				continue;
			}
			const canonical = await cx.outline.alias(path, cx.ctx);
			if (canonical) {
				if (redirected_policy !== 'ok') {
					findings.push({
						...at,
						severity: redirected_policy === 'error' ? 'error' : 'warn',
						message: `'${href}' works via redirect_from → update to ${href_of(b, canonical)}`
					});
				}
				continue;
			}
			findings.push({
				...at,
				severity: 'error',
				message: `'${href}': missing page${link.text ? ` — link text "${link.text}"` : ''}`
			});
		}
		return findings;
	};

	return {
		name: 'links',
		page: check_page,
		async site(cx) {
			const out: Finding[] = [];
			for (const slug of await cx.outline.addresses(cx.ctx))
				out.push(...(await check_page(slug, cx)));
			return out;
		}
	};
}

/** Run every check's `page` pass for one slug. */
export async function run_page_checks(
	checks: Check[],
	slug: string,
	cx: CheckContext
): Promise<Finding[]> {
	const out: Finding[] = [];
	for (const c of checks) if (c.page) out.push(...(await c.page(slug, cx)));
	return out;
}

/** Run every check's whole-corpus pass (default: `page` over every address). */
export async function run_site_checks(checks: Check[], cx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	for (const c of checks) {
		if (c.site) out.push(...(await c.site(cx)));
		else if (c.page)
			for (const slug of await cx.outline.addresses(cx.ctx)) out.push(...(await c.page(slug, cx)));
	}
	return out;
}

/** A page's findings as ONE message's arguments — file-anchored, every finding named. */
export function format_findings(
	slug: string,
	findings: Finding[],
	file: string | undefined
): { slug: string; file: string; count: number; findings: string } {
	const rows = findings.map(
		(f) => `  - [${f.check}] ${f.message}${f.line !== undefined ? ` (line ~${f.line})` : ''}`
	);
	return { slug, file: file ?? '', count: findings.length, findings: rows.join('\n') };
}
