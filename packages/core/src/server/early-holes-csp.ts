/**
 * THE EARLY START'S SCRIPT UNDER A CONTENT SECURITY POLICY (../early-holes.ts). Its bytes never
 * change, so its `'sha256-…'` source is computed once, here. A policy that would block an inline
 * script gets that one source added to the directive that rules script elements:
 * `script-src-elem`, else `script-src`, else `default-src`. Nothing else in the policy changes:
 *
 *   - no such directive: inline scripts are not restricted, nothing to add;
 *   - `'none'`: no script runs, ours neither;
 *   - `'unsafe-inline'` with no nonce or hash: inline scripts run already, and adding a hash would
 *     switch `'unsafe-inline'` off for every other one;
 *   - a nonce or `'strict-dynamic'` policy: a hash is a valid source beside both.
 *
 * Server-only (node:crypto).
 */
import { createHash } from 'node:crypto';
import { EARLY_HOLES_TAG } from '../early-holes-head.ts';
import { next_tag, text_of, value_at } from '../wire-markup.ts';

/** The text between a tag's `<script…>` and `</script>`: what a CSP hash covers. */
export function script_text(tag: string): string {
	const script = next_tag(tag, 'script', 0);
	return (script && text_of(tag, script, 'script')) ?? '';
}

/** The script's hash source, as a policy lists it: of the exact text the head carries, once. */
export const EARLY_HOLES_SOURCE: string = `'sha256-${createHash('sha256').update(script_text(EARLY_HOLES_TAG), 'utf8').digest('base64')}'`;

/** The directives that rule an inline `<script>`, the most specific first. */
const SCRIPT_DIRECTIVES = ['script-src-elem', 'script-src', 'default-src'] as const;
const NONCE_OR_HASH_RE = /^'(?:nonce|sha256|sha384|sha512)-/i;
const WHITESPACE_RE = /\s+/;

/** The `'sha256-…'` source of an inline script's text, as a policy lists it. */
export function inline_source(text: string): string {
	return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** One serialized policy (`directive sources; …`) with the hash where an inline script needs it. */
function with_hash(policy: string, add: readonly string[]): string {
	const parts = policy.split(';');
	const names = parts.map((p) => p.trim().split(WHITESPACE_RE)[0]?.toLowerCase() ?? '');
	for (const directive of SCRIPT_DIRECTIVES) {
		const at = names.indexOf(directive);
		if (at === -1) continue;
		const sources = parts[at]!.trim().split(WHITESPACE_RE).slice(1);
		const lower = sources.map((s) => s.toLowerCase());
		const missing = add.filter((s) => !sources.includes(s));
		if (missing.length === 0) return policy;
		if (lower.length === 1 && lower[0] === "'none'") return policy;
		if (lower.includes("'unsafe-inline'") && !sources.some((s) => NONCE_OR_HASH_RE.test(s)))
			return policy;
		parts[at] = `${parts[at]!.replace(/\s*$/, '')} ${missing.join(' ')}`;
		return parts.join(';');
	}
	return policy;
}

/**
 * A `Content-Security-Policy` (or `-Report-Only`) header value with the early start's hash (or the
 * given inline scripts' `sources`) where its script would be blocked. A header can carry several
 * policies, comma-separated: each is checked.
 */
export function with_early_holes_csp(
	header: string,
	sources: readonly string[] = [EARLY_HOLES_SOURCE]
): string {
	if (!header || sources.length === 0) return header;
	return header
		.split(',')
		.map((p) => with_hash(p, sources))
		.join(',');
}

const HTTP_EQUIV_RE = /http-equiv/i;

/** A head's `<meta http-equiv="content-security-policy">` policies, each with the hash where its
 *  script would be blocked. A head with none comes back as itself. A rewritten value is written
 *  double-quoted: the hash source's own quotes would end a single-quoted or unquoted one. */
export function with_early_holes_meta_csp(
	head: string,
	sources: readonly string[] = [EARLY_HOLES_SOURCE]
): string {
	// (most heads carry no http-equiv at all: one search answers them)
	if (sources.length === 0 || !HTTP_EQUIV_RE.test(head)) return head;
	let out = '';
	let kept = 0;
	for (let t = next_tag(head, 'meta', 0); t !== null; t = next_tag(head, 'meta', t.next)) {
		if (t.attr('http-equiv')?.toLowerCase() !== 'content-security-policy') continue;
		const at = value_at(head, t, 'meta', 'content');
		if (at === -1) continue;
		const policy = t.attr('content')!;
		const next = with_early_holes_csp(policy, sources);
		if (next === policy) continue;
		const quoted = head[at - 1] === '"' || head[at - 1] === "'";
		const from = quoted ? at - 1 : at;
		out = `${out}${head.slice(kept, from)}"${next.replaceAll('"', '&quot;')}"`;
		kept = at + policy.length + (quoted ? 1 : 0);
	}
	return kept === 0 ? head : out + head.slice(kept);
}

const CSP_HEADERS = ['content-security-policy', 'content-security-policy-report-only'] as const;

/** A response's CSP headers (enforced and report-only), each with the hash where it is needed. */
export function add_early_holes_csp(
	headers: Headers,
	sources: readonly string[] = [EARLY_HOLES_SOURCE]
): void {
	if (sources.length === 0) return;
	for (const name of CSP_HEADERS) {
		const value = headers.get(name);
		if (!value) continue;
		const next = with_early_holes_csp(value, sources);
		if (next !== value) headers.set(name, next);
	}
}
