import { escapeAttr as escape_amp_quot } from '@ogygia/core/plugin/utils';
import { next_open_or_close, OG_STITCHED, type FoundTag } from '@ogygia/core/internal/server';

const STITCH_ANY_CASE = /stitch/i;
const REGION = 'ogygia-region';
const AMP_RE = /&amp;/g;

/** How a stitch hole fills: `'serve'` = the ORIGIN re-renders + splices on every serve (per-visitor
 *  page, edge-bypassed) · `'edge'` = the CDN fills an ESI include per request (the shell stays
 *  edge-cached; origin renders only the hole). A bare `stitch` attribute (older builds) reads as
 *  `'serve'`. */
export type StitchMode = 'serve' | 'edge';

export interface StitchHole {
	/** Absolute span of the WHOLE region block (open tag through matching close). */
	start: number;
	end: number;
	/** The signed capability URL from the `endpoint` attribute, entity-unescaped. */
	endpoint: string;
	mode: StitchMode;
}

/** Which stitch modes a stored page carries. One `'serve'` hole makes the WHOLE page per-visitor
 *  (serve taints); a page whose stitch holes are all `'edge'` stays edge-cacheable. */
export function stitch_modes(html: string): { serve: boolean; edge: boolean } {
	const holes = find_stitch_holes(html);
	return {
		serve: holes.some((h) => h.mode === 'serve'),
		edge: holes.some((h) => h.mode === 'edge')
	};
}

/**
 * EDGE STITCHING (ESI): rewrite every `stitch="edge"` hole so an ESI-capable CDN (Akamai, Fastly,
 * Varnish) fills it per request from the hole's own signed capability, while the shell around it
 * stays cached at the edge. The region block is wrapped in `<esi:remove>` and followed by an
 * `<esi:include>`:
 *   - on an ESI edge the wrapper is stripped and the include is fetched from origin (with the
 *     viewer's cookies, per the edge config) → a personal first paint, shell served from cache,
 *     origin renders ONE region;
 *   - anywhere ESI is not processed (direct origin, dev, a non-ESI CDN) `<esi:remove>` is an
 *     unknown element whose CHILDREN still render and `<esi:include>` is inert — the hole ships its
 *     fallback and the client fetches it exactly like a normal deferred hole. Graceful either way.
 * Pure string function; the capture runs it at store time (the etag is minted over the result).
 * `page_path` is the stored page's pathname: the hole's endpoint is emitted PAGE-RELATIVE
 * (`../../__ogygia__?…` under Kit's relative paths), and an ESI include must be an absolute path
 * the edge can fetch from origin without knowing the page — so each src is resolved here.
 */
export function esi_rewrite(html: string, page_path = '/'): string {
	const holes = find_stitch_holes(html).filter((h) => h.mode === 'edge');
	if (!holes.length) return html;
	const out: string[] = [];
	let last = 0;
	for (const h of holes) {
		const abs = new URL(h.endpoint, `http://o${page_path}`);
		const src = escape_amp_quot(abs.pathname + abs.search);
		out.push(
			html.slice(last, h.start),
			`<esi:remove>${html.slice(h.start, h.end)}</esi:remove><esi:include src="${src}" onerror="continue"/>`
		);
		last = h.end;
	}
	out.push(html.slice(last));
	return out.join('');
}

/** Find every TOP-LEVEL stitch-marked region block, balanced across nested regions. */
export function find_stitch_holes(html: string): StitchHole[] {
	const holes: StitchHole[] = [];
	if (!STITCH_ANY_CASE.test(html)) return holes;
	let depth = 0;
	let open: FoundTag | null = null;
	// (the region's tags as the browser reads them: none inside a comment or raw text, #975)
	for (let t = next_open_or_close(html, REGION, 0); t !== null;) {
		if ('tag' in t) {
			if (depth === 0) open = t.tag;
			depth++;
			t = next_open_or_close(html, REGION, t.tag.next);
			continue;
		}
		const end = t.end;
		t = next_open_or_close(html, REGION, end);
		// (an end tag with no region open closes nothing, as in the browser's tree)
		if (depth === 0) continue;
		depth--;
		if (depth === 0 && open !== null) {
			// `stitch="edge"`: the ESI mode. Any other `stitch` (`"serve"`, or the bare attribute an
			// older build emitted) is the origin-serve mode.
			const stitch = open.attr('stitch');
			if (stitch !== undefined) {
				const endpoint = open.attr('endpoint')?.replace(AMP_RE, '&') ?? '';
				if (endpoint)
					holes.push({
						start: open.start,
						end,
						endpoint,
						mode: stitch === 'edge' ? 'edge' : 'serve'
					});
			}
			open = null;
		}
	}
	return holes;
}

/**
 * Splice fresh renders into every stitch hole (`stitch: 'serve'`): on each serve of a stored page
 * the handle renders its holes for this visitor and splices them into the stored bytes. `render`
 * resolves an endpoint to HTML or null; null or a throw keeps that hole's block verbatim, so its
 * fallback ships and the client fetches it as an unstitched hole would. Holes render in parallel.
 * A filled hole becomes a `display:contents` div, so the regions inside it are top-level and wake
 * on their own.
 */
export async function stitch_html(
	html: string,
	render: (endpoint: string) => Promise<string | null>
): Promise<string> {
	const holes = find_stitch_holes(html);
	if (!holes.length) return html;
	// oxlint-disable-next-line ogygia/no-silent-failures -- fail-open, the hole keeps its fallback and fetches itself as an unstitched hole would
	const rendered = await Promise.all(holes.map((h) => render(h.endpoint).catch(() => null)));
	const out: string[] = [];
	let last = 0;
	for (let i = 0; i < holes.length; i++) {
		const fill = rendered[i];
		if (fill === null) continue;
		out.push(
			html.slice(last, holes[i].start),
			`<div style="display:contents" ${OG_STITCHED}="">${fill}</div>`
		);
		last = holes[i].end;
	}
	out.push(html.slice(last));
	return out.join('');
}
