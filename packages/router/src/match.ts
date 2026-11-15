export interface ParamSpec {
	name: string;
	/** `[...rest]` — captures the remaining path (slashes included), may be '' */
	rest?: boolean;
	/** `[[opt]]` — the segment may be absent; param is `undefined` when so */
	optional?: boolean;
}

export interface CompiledPattern {
	/** the original table key, e.g. '/docs/[slug]' — also the route.id we expose */
	pattern: string;
	regex: RegExp;
	params: ParamSpec[];
}

const REGEX_SPECIAL_G = /[.*+?^${}()|[\]\\]/g;
const escape_re = (s: string) => s.replace(REGEX_SPECIAL_G, '\\$&');
const REST = /^\[\.\.\.([a-zA-Z_$][\w$]*)\]$/;
const OPTIONAL = /^\[\[([a-zA-Z_$][\w$]*)\]\]$/;
const VALID_PARAM_GROUPS = /\[[a-zA-Z_$][\w$]*\]/g;
const INNER_PARAM = /\[([a-zA-Z_$][\w$]*)\]/g;

const has_stray_bracket = (seg: string) => {
	const left = seg.replace(VALID_PARAM_GROUPS, '');
	return left.includes('[') || left.includes(']');
};

/**
 * Compiles a route pattern in Kit's grammar (`/docs/[slug]`, `/files/[...rest]`, `/[[lang]]/docs`,
 * and mixed segments like `/[id].json`) into a trailing-slash-insensitive regex and its params.
 * Throws on a malformed pattern. A table's order is {@link compile_all}'s.
 */
export function compile(pattern: string): CompiledPattern {
	if (!pattern.startsWith('/')) {
		throw new Error(
			`[@ogygia/router] route pattern must start with "/": ${JSON.stringify(pattern)}`
		);
	}
	const segs = pattern.split('/').filter((s) => s !== '');
	const params: ParamSpec[] = [];
	const rx: string[] = [];

	segs.forEach((seg, i) => {
		let m: RegExpMatchArray | null;
		if ((m = seg.match(REST))) {
			if (i !== segs.length - 1) {
				throw new Error(
					`[@ogygia/router] a [...rest] segment must be last: ${JSON.stringify(pattern)}`
				);
			}
			params.push({ name: m[1], rest: true });
			rx.push('(?:/(.*))?');
		} else if ((m = seg.match(OPTIONAL))) {
			params.push({ name: m[1], optional: true });
			rx.push('(?:/([^/]+))?');
		} else {
			const pieces: Array<{ text: string } | { name: string }> = [];
			let last = 0;
			INNER_PARAM.lastIndex = 0;
			let g: RegExpExecArray | null;
			while ((g = INNER_PARAM.exec(seg))) {
				const pre = seg.slice(last, g.index);
				if (pre) pieces.push({ text: pre });
				pieces.push({ name: g[1] });
				last = INNER_PARAM.lastIndex;
			}
			const tail = seg.slice(last);
			if (tail) pieces.push({ text: tail });
			let inner = '/';
			let has_static = false;
			let has_param = false;
			let params_left = pieces.filter((p) => 'name' in p).length;
			pieces.forEach((p, j) => {
				if ('text' in p) {
					inner += escape_re(p.text);
					has_static = true;
					return;
				}
				params_left--;
				const next = pieces[j + 1];
				const group = params.length + 1;
				// @why a param with another after it takes the shortest run its literal follows, as an atomic group never backtracked into, so the match is linear and splits as Kit's lazy params do (test: test/router-match.test.ts › a segment with several params answers a long path that almost matches at once)
				let capture = '([^/])';
				if (params_left === 0) capture = '([^/]+)';
				else if (next && 'text' in next) capture = `(?=([^/]+?)${escape_re(next.text)})\\${group}`;
				inner += capture;
				params.push({ name: p.name });
				has_param = true;
			});
			if (has_stray_bracket(seg) || (!has_static && !has_param)) {
				throw new Error(`[@ogygia/router] malformed segment ${JSON.stringify(seg)} in ${pattern}`);
			}
			rx.push(inner);
		}
	});

	const regex = new RegExp(`^${rx.length ? rx.join('') : '/?'}/?$`);
	return { pattern, regex, params };
}

/** Compile a whole table's keys and sort them in Kit's route order, so the first match is the
 *  route Kit would pick for the same files (test/router-route-order.test.ts). */
export function compile_all(patterns: string[]): CompiledPattern[] {
	const segments = new Map(patterns.map((p) => [p, route_segments(p)]));
	return patterns
		.map(compile)
		.sort((a, b) =>
			kit_order(a.pattern, segments.get(a.pattern)!, b.pattern, segments.get(b.pattern)!)
		);
}

type Part = { type: 'static' | 'required' | 'optional' | 'rest'; content: string };
const EMPTY_PART: Part = { type: 'static', content: '' };
const PARAM_KIND: Readonly<Record<string, 'optional' | 'rest' | undefined>> = {
	'[': 'optional',
	'.': 'rest'
};
const NON_FINAL_OPTIONAL_G = /\[\[[^\]]+\]\](?!$)/g;

/** A pattern as Kit sorts it: its segments, each split into parts that alternate static (first,
 *  maybe '') and dynamic. An `[[optional]]` that is not last counts for nothing. */
function route_segments(pattern: string): Part[][] {
	return pattern
		.replace(NON_FINAL_OPTIONAL_G, '')
		.split('/')
		.filter(Boolean)
		.map((segment) => {
			const parts: Part[] = [];
			let i = 0;
			for (;;) {
				const start = segment.indexOf('[', i);
				if (start === -1) {
					parts.push({ type: 'static', content: segment.slice(i) });
					return parts;
				}
				parts.push({ type: 'static', content: segment.slice(i, start) });
				const type = PARAM_KIND[segment[start + 1]] ?? 'required';
				i =
					segment.indexOf(type === 'optional' ? ']]' : ']', start) + (type === 'optional' ? 2 : 1);
				parts.push({ type, content: segment.slice(start, i) });
			}
		});
}

/** Kit's route comparator (`sort_routes`): segment by segment from the left, a static part beats a
 *  dynamic one and a required param beats an optional one, a shallower path beats a deeper one
 *  on a static difference, `[...rest]` ranks below anything with a static part after it, and a tie
 *  goes by route id (never by table order). Negative: `a` first. */
function kit_order(a_id: string, a: Part[][], b_id: string, b: Part[][]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const seg_a = a[i] ?? [EMPTY_PART];
		const seg_b = b[i] ?? [EMPTY_PART];
		for (let j = 0; j < Math.max(seg_a.length, seg_b.length); j++) {
			const pa = seg_a[j];
			const pb = seg_b[j];
			if (j % 2 === 1) {
				if (!pa) return -1;
				if (!pb) return 1;
				// the next static chunk, for the [...rest] cases
				const next_a = seg_a[j + 1].content || a[i + 1]?.[0].content;
				const next_b = seg_b[j + 1].content || b[i + 1]?.[0].content;
				if (pa.type === 'rest' && pb.type === 'rest') {
					if (next_a && !next_b) return -1;
					if (next_b && !next_a) return 1;
					// (Kit answers "b first" both ways round when neither has a next part, so its pick
					// follows file order; here the tie goes by id)
					continue;
				}
				if (pa.type === 'rest') return next_a && !next_b ? -1 : 1;
				if (pb.type === 'rest') return next_b && !next_a ? 1 : -1;
				if (pa.type !== pb.type) {
					if (pa.type === 'required') return -1;
					if (pb.type === 'required') return 1;
				}
			} else if (pa.content !== pb.content) {
				if (pa === EMPTY_PART) return -1;
				if (pb === EMPTY_PART) return 1;
				return static_order(pa.content, pb.content);
			}
		}
	}
	return a_id < b_id ? 1 : -1;
}

/** Lexicographic, except a longer static outranks its own prefix (`foobar` before `foo`). */
function static_order(a: string, b: string): number {
	for (let i = 0; ; i++) {
		if (a[i] !== b[i]) {
			if (a[i] === undefined) return 1;
			if (b[i] === undefined) return -1;
			return a[i] < b[i] ? -1 : 1;
		}
	}
}

export interface PathMatch {
	pattern: string;
	params: Record<string, string | undefined>;
}

/** Match one compiled pattern against a pathname. Returns params, or null if it doesn't match. */
export function match_one(c: CompiledPattern, pathname: string): PathMatch | null {
	const m = c.regex.exec(pathname);
	if (!m) return null;
	const params: Record<string, string | undefined> = {};
	c.params.forEach((spec, i) => {
		const raw = m[i + 1];
		if (spec.rest) {
			params[spec.name] = raw == null ? '' : safe_decode(raw);
		} else if (spec.optional) {
			params[spec.name] = raw == null ? undefined : safe_decode(raw);
		} else {
			params[spec.name] = safe_decode(raw);
		}
	});
	return { pattern: c.pattern, params };
}

const fill_token = /\[(\.\.\.)?\[?([a-zA-Z_$][\w$]*)\]?\]/g;
/** A segment that is one `[[optional]]` or `[...rest]` token and nothing else. */
const DROPPABLE_SEGMENT_RE = /^\[(?:\.\.\.[a-zA-Z_$][\w$]*|\[[a-zA-Z_$][\w$]*\])\]$/;

/** Fills a pattern's `[param]`, `[[optional]]` and `[...rest]` tokens from `params`, URL-encoded
 *  as Kit's `resolve()` writes them: a rest value keeps its `/` (each segment encoded), and an
 *  empty optional or rest param that is a whole segment drops that segment. A missing `[param]`
 *  becomes empty. Throws on a value that would fill a whole segment with `.` or `..`: every URL
 *  parser drops that segment, so the URL would name another route (`%2e` is read as a dot too).
 *  Throws on an empty segment too, other than a dropped one or the last: a rest value with an
 *  empty piece (a leading, trailing or doubled `/`), or a param that fills its segment empty,
 *  would build `//host` (a URL of another origin) or a path that routes elsewhere.
 *  Tests: test/property-fill-match.test.ts, test/router-match.test.ts. */
export function fill(pattern: string, params: Record<string, string | number>): string {
	// (segment by segment: a token never spans a `/`, and a segment is a dot segment whatever filled
	// it, one token, several, a token beside a literal dot, or one piece of a rest value)
	const segs: string[] = [];
	const parts = pattern.split('/');
	for (let i = 0; i < parts.length; i++) {
		const seg = parts[i];
		const out = seg.replace(fill_token, (_m, rest: string | undefined, name: string) => {
			const val = params[name] == null ? '' : String(params[name]);
			if (!rest) return encodeURIComponent(val);
			const pieces = val.split('/');
			// (an empty piece is an empty segment: a leading one builds `//host`, a URL of another
			// origin, and any other names a path Kit routes elsewhere)
			if (val !== '' && pieces.includes(''))
				throw new Error(
					`[@ogygia/router] the rest param "${name}" has an empty segment (${JSON.stringify(val)}): it would name another URL than ${pattern}`
				);
			return pieces.map(encodeURIComponent).join('/');
		});
		if (out === '' && DROPPABLE_SEGMENT_RE.test(seg)) continue;
		// (any param that fills its segment empty, but the last: an empty first one starts the path
		// with `//`, a URL of another origin, and one between builds a path Kit routes elsewhere)
		if (out === '' && seg !== '' && i < parts.length - 1)
			throw new Error(
				`[@ogygia/router] the segment "${seg}" fills empty, an empty segment: it would name another URL than ${pattern}`
			);
		if (out !== seg && out.split('/').some((p) => p === '.' || p === '..'))
			throw new Error(
				`[@ogygia/router] the segment "${seg}" fills as ${JSON.stringify(out)}, a dot segment a URL drops: it would name another route than ${pattern}`
			);
		segs.push(out);
	}
	const filled = segs.join('/');
	// (a pattern that was only dropped segments is the root)
	return filled === '' && pattern !== '' ? '/' : filled;
}

const MAX_PATH = 8192;

/** First (most-specific) match in a pre-sorted list, or null. */
export function match_path(sorted: CompiledPattern[], pathname: string): PathMatch | null {
	if (pathname.length > MAX_PATH) return null;
	for (const c of sorted) {
		const hit = match_one(c, pathname);
		if (hit) return hit;
	}
	return null;
}

function safe_decode(s: string): string {
	try {
		return decodeURIComponent(s);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a malformed escape matches as it was written
	} catch {
		return s;
	}
}
