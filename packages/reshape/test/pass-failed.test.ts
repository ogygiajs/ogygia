/**
 * The app's pass failing (#1569): a transform that throws, and one that drops ogygia's marks from a
 * host ogygia will restore. In production the answer it ran on goes out as ogygia rendered it,
 * before the pass, and the failure is said once with its code; in dev it is thrown with the code,
 * so the developer sees the broken pass at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { RESTORER_SCRIPT, reshape_pass } from '../src/pass.ts';
import type { ReshapeTransform } from '../src/index.ts';

const event = { request: new Request('http://x/'), url: new URL('http://x/') } as RequestEvent;

const island = (inner: string) =>
	`<ogygia-region entry="./a.js" data-og-fp="f1">${inner}</ogygia-region>`;
const doc = (body: string) =>
	`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
/** A host ogygia will restore: a custom element in an island's markup. */
const page = doc(island('<demo-card class="own"><i>ok</i></demo-card>'));
const answer = '<demo-card><i>ok</i></demo-card>';

/** A render that writes the plan on every host it was given, as reshape asks. */
const renders: ReshapeTransform = (html) =>
	html.replace(/<demo-card( og-h="\d+")/g, '<demo-card$1 og-shadow="demo-card.shadow"');
/** A render that drops every `og-*` attribute: ogygia can restore nothing it marked. */
const strips: ReshapeTransform = (html) => html.replace(/ og-[a-z]+="[^"]*"/g, '');
const boom = new Error('boom');
const throws: ReshapeTransform = () => {
	throw boom;
};

let said: unknown[][];
beforeEach(() => {
	said = [];
	const keep = (...a: unknown[]) => {
		said.push(a);
	};
	vi.spyOn(console, 'warn').mockImplementation(keep);
	vi.spyOn(console, 'error').mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());
const told = (code: string) => said.filter((a) => a.some((x) => String(x).includes(code)));

describe("production: the app's pass failing", () => {
	it('a transform that throws: the page goes out as ogygia rendered it, said once with reshape_pass_failed (gen 10, seed 10)', async () => {
		const pass = reshape_pass(throws, event, { dev: false });
		const out = await pass.document(page, { csr: false, answer: false });
		expect(out).toEqual({ html: page, head: '', body: RESTORER_SCRIPT });
		expect(await pass.region(answer)).toBe(answer);
		expect(told('reshape_pass_failed')).toHaveLength(2);
	});

	it("a transform that drops ogygia's marks: the answer goes out as ogygia rendered it, said once with reshape_marks_lost (gen 10, seed 5)", async () => {
		const pass = reshape_pass(strips, event, { dev: false });
		const out = await pass.document(page, { csr: false, answer: false });
		expect(out).toEqual({ html: page, head: '', body: RESTORER_SCRIPT });
		expect(await pass.region(answer)).toBe(answer);
		expect(told('reshape_marks_lost')).toHaveLength(2);
	});

	it("a document the pass failed on still carries the restorer: the router's next page and the holes it answers are restored (gen 10, seed 36: a hydration mismatch after a router visit)", async () => {
		const pass = reshape_pass(throws, event, { dev: false });
		const out = await pass.document(page, { csr: false, answer: false });
		expect(out.body).toContain('data-og-restore');
		const later = reshape_pass(renders, event, { dev: false });
		const next = await later.document(page, { csr: false, answer: true });
		expect(next.html).toContain('og-shadow="demo-card.shadow"');
	});

	it('a transform that keeps the marks, or has no host to keep them on, is used and says nothing', async () => {
		const pass = reshape_pass(renders, event, { dev: false });
		const out = await pass.document(page, { csr: false, answer: false });
		expect(out.html).toContain('og-shadow="demo-card.shadow"');
		expect(await pass.region(answer)).toContain('og-shadow="demo-card.shadow"');
		const plain = reshape_pass(strips, event, { dev: false });
		await plain.document(doc('<p>no custom element</p>'), { csr: false, answer: false });
		expect(await plain.region('<p>no custom element</p>')).toBe('<p>no custom element</p>');
		expect(told('reshape_marks_lost')).toHaveLength(0);
		expect(told('reshape_pass_failed')).toHaveLength(0);
	});
});

describe("dev: the app's pass failing", () => {
	it('a transform that throws is thrown with reshape_pass_failed', async () => {
		const pass = reshape_pass(throws, event, { dev: true });
		await expect(pass.document(page, { csr: false, answer: false })).rejects.toThrow(
			/reshape_pass_failed/
		);
		await expect(pass.region(answer)).rejects.toThrow(/reshape_pass_failed/);
	});

	it("a transform that drops ogygia's marks is thrown with reshape_marks_lost", async () => {
		const pass = reshape_pass(strips, event, { dev: true });
		await expect(pass.document(page, { csr: false, answer: false })).rejects.toThrow(
			/reshape_marks_lost/
		);
		await expect(pass.region(answer)).rejects.toThrow(/reshape_marks_lost/);
	});
});
