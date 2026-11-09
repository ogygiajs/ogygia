// THE EARLY START'S SCRIPT UNDER A CONTENT SECURITY POLICY (#404). Its bytes never change, so its
// hash is a constant, and a policy that would block it gets that hash added, nothing else changed.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { early_holes_head } from '../src/early-holes-head.ts';
import {
	EARLY_HOLES_SOURCE,
	with_early_holes_csp,
	with_early_holes_meta_csp
} from '../src/server/early-holes-csp.ts';

const H = EARLY_HOLES_SOURCE;
const SCRIPT_BODY_G = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;

describe('the early start script under a CSP', () => {
	it('its hash is of the exact text the head emits for it, on any page', () => {
		for (const endpoints of [['./__ogygia__?id=a&sig=1'], ['/x?id=b', '/x?id=c&props=W10']]) {
			const tags = [...early_holes_head(endpoints).matchAll(SCRIPT_BODY_G)];
			expect(tags).toHaveLength(2);
			const run = tags[1]![0];
			expect(run.startsWith('<script>')).toBe(true);
			const digest = createHash('sha256').update(tags[1]![1]!, 'utf8').digest('base64');
			expect(H).toBe(`'sha256-${digest}'`);
		}
	});

	it('its data block is JSON, which no policy needs a hash for', () => {
		expect(early_holes_head(['/x?id=a'])).toMatch(
			/^<script type="application\/json" id="ogygia-early-holes">\["\/x\?id=a"\]<\/script>/
		);
	});

	it('no policy: nothing to add', () => {
		expect(with_early_holes_csp('')).toBe('');
	});

	it('a policy with no script rule (no default either) is left alone', () => {
		expect(with_early_holes_csp("img-src 'self'; frame-ancestors 'none'")).toBe(
			"img-src 'self'; frame-ancestors 'none'"
		);
	});

	it('script-src that would block it gets the hash', () => {
		expect(with_early_holes_csp("default-src 'self'; script-src 'self'")).toBe(
			`default-src 'self'; script-src 'self' ${H}`
		);
	});

	it('a nonce policy takes the hash beside its nonce', () => {
		expect(with_early_holes_csp("script-src 'nonce-abc123'")).toBe(
			`script-src 'nonce-abc123' ${H}`
		);
	});

	it("'strict-dynamic' takes the hash too (a hashed script is trusted there)", () => {
		expect(with_early_holes_csp("script-src 'nonce-abc' 'strict-dynamic' https:")).toBe(
			`script-src 'nonce-abc' 'strict-dynamic' https: ${H}`
		);
	});

	it("'unsafe-inline' without a nonce or hash already runs it: left alone (a hash would turn it off)", () => {
		expect(with_early_holes_csp("script-src 'self' 'unsafe-inline'")).toBe(
			"script-src 'self' 'unsafe-inline'"
		);
	});

	it("'unsafe-inline' beside a hash is off already: the hash is added", () => {
		expect(with_early_holes_csp("script-src 'unsafe-inline' 'sha256-abc='")).toBe(
			`script-src 'unsafe-inline' 'sha256-abc=' ${H}`
		);
	});

	it('no script-src: the default-src it falls back to gets the hash', () => {
		expect(with_early_holes_csp("default-src 'self'; img-src *")).toBe(
			`default-src 'self' ${H}; img-src *`
		);
	});

	it('script-src-elem rules script elements: it gets the hash, script-src stays', () => {
		expect(with_early_holes_csp("script-src 'self'; script-src-elem 'self'")).toBe(
			`script-src 'self'; script-src-elem 'self' ${H}`
		);
	});

	it("'none' stays none: no script runs there, ours neither", () => {
		expect(with_early_holes_csp("script-src 'none'")).toBe("script-src 'none'");
	});

	it('a policy that has the hash already is unchanged', () => {
		expect(with_early_holes_csp(`script-src 'self' ${H}`)).toBe(`script-src 'self' ${H}`);
	});

	it('every policy of a header that carries several gets it', () => {
		expect(
			with_early_holes_csp("script-src 'self', default-src 'none'; script-src 'nonce-x'")
		).toBe(`script-src 'self' ${H}, default-src 'none'; script-src 'nonce-x' ${H}`);
	});

	it('a <meta http-equiv> policy in the head gets it, the rest of the head untouched', () => {
		const head =
			'<meta charset="utf-8"><meta http-equiv="content-security-policy" content="script-src \'self\'"><title>x</title>';
		expect(with_early_holes_meta_csp(head)).toBe(
			`<meta charset="utf-8"><meta http-equiv="content-security-policy" content="script-src 'self' ${H}"><title>x</title>`
		);
	});

	it('a head with no policy meta is returned as is', () => {
		const head = '<meta charset="utf-8"><title>x</title>';
		expect(with_early_holes_meta_csp(head)).toBe(head);
	});
});
