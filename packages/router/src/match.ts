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
	/** higher = more specific; used to order overlapping matches (static beats dynamic) */
	score: number;
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

const SEGMENT_RANK = { static: 4, mixed: 3, param: 2, optional: 1, rest: 0 } as const;

/**
 * Compiles a route pattern in Kit's grammar (`/docs/[slug]`, `/files/[...rest]`, `/[[lang]]/docs`,
 * and mixed segments like `/[id].json`) into a trailing-slash-insensitive regex, its params and a
 * specificity score (higher sorts first). Throws on a malformed pattern.
 */
export function compile(pattern: string): CompiledPattern {
	if (!pattern.startsWith('/')) {
		throw new Error(
			`[@ogygia/router] route pattern must start with "/": ${JSON.stringify(pattern)}`
		);
	}
	const segs = pattern.split('/').filter((s) => s !== '');
	const params: ParamSpec[] = [];
	const ranks: number[] = [];
	let rx = '';

	segs.forEach((seg, i) => {
		let m: RegExpMatchArray | null;
		if ((m = seg.match(REST))) {
			if (i !== segs.length - 1) {
				throw new Error(
					`[@ogygia/router] a [...rest] segment must be last: ${JSON.stringify(pattern)}`
				);
			}
			params.push({ name: m[1], rest: true });
			rx += '(?:/(.*))?';
			ranks.push(SEGMENT_RANK.rest);
		} else if ((m = seg.match(OPTIONAL))) {
			params.push({ name: m[1], optional: true });
			rx += '(?:/([^/]+))?';
			ranks.push(SEGMENT_RANK.optional);
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
				inner +=
					params_left === 0
						? '([^/]+)'
						: next && 'text' in next
							? `(?=([^/]+?)${escape_re(next.text)})\\${group}`
							: '([^/])';
				params.push({ name: p.name });
				has_param = true;
			});
			if (has_stray_bracket(seg) || (!has_static && !has_param)) {
				throw new Error(`[@ogygia/router] malformed segment ${JSON.stringify(seg)} in ${pattern}`);
			}
			rx += inner;
			ranks.push(
				!has_param ? SEGMENT_RANK.static : has_static ? SEGMENT_RANK.mixed : SEGMENT_RANK.param
			);
		}
	});

	if (rx === '') rx = '/?';
	const regex = new RegExp('^' + rx + '/?$');
	const trailing_rest = params.length > 0 && params[params.length - 1].rest === true;
	return { pattern, regex, params, score: specificity(ranks, trailing_rest) };
}

function specificity(ranks: number[], trailing_rest: boolean): number {
	const depth_ranks = trailing_rest ? ranks.slice(0, -1) : ranks;
	let score = 0;
	for (const rank of depth_ranks) score = score * 5 + rank;
	score = score * 64 + depth_ranks.length;
	return trailing_rest ? score - 1 : score;
}

/** Compile a whole table's keys and sort most-specific-first, so the first match wins. */
export function compile_all(patterns: string[]): CompiledPattern[] {
	return patterns.map(compile).sort((a, b) => b.score - a.score);
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

/** Fills a pattern's `[param]`, `[[optional]]` and `[...rest]` tokens from `params`, URL-encoded;
 *  a missing one becomes empty. */
export function fill(pattern: string, params: Record<string, string | number>): string {
	return pattern.replace(fill_token, (_m, _rest, name: string) => {
		const val = params[name];
		return val == null ? '' : encodeURIComponent(String(val));
	});
}

/** The longest pathname any route is matched against (longer: no route, a 404). */
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
	} catch {
		return s;
	}
}
