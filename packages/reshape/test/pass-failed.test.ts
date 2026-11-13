/**
 * The app's pass failing, said with a code of reshape's own (#1569): a transform that throws, and
 * one that drops ogygia's marks from a host ogygia will restore. What happens to the page is
 * unchanged here; the codes make the failure visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server from '../src/server.ts';
import { handle, type ReshapeTransform } from '../src/index.ts';

const ok = async () => new Response('ok');

/** The pass for one request that `transform` wraps. */
async function pass_of(transform: ReshapeTransform) {
	startPlugin(server, { name: '@ogygia/reshape' });
	const request = new Request('http://x/');
	const event = { request, url: new URL(request.url) } as RequestEvent;
	await handle(transform)({ event, resolve: ok });
	return server.pass!(event)!;
}

const island = (inner: string) =>
	`<ogygia-region entry="./a.js" data-og-fp="f1">${inner}</ogygia-region>`;
const doc = (body: string) =>
	`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
/** A host ogygia will restore: a custom element in an island's markup. */
const page = doc(island('<demo-card class="own"><i>ok</i></demo-card>'));

/** A render that writes the plan on every host it was given, as reshape asks. */
const renders: ReshapeTransform = (html) =>
	html.replace(/<demo-card( og-h="\d+")/g, '<demo-card$1 og-shadow="demo-card.shadow"');
/** A render that drops every `og-*` attribute: ogygia can restore nothing it marked. */
const strips: ReshapeTransform = (html) => html.replace(/ og-[a-z]+="[^"]*"/g, '');

let warns: unknown[][];
beforeEach(() => {
	warns = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		warns.push(a);
	});
});
afterEach(() => vi.restoreAllMocks());
const said = (code: string) => warns.filter((a) => a.some((x) => String(x).includes(code)));

describe("the app's pass failing", () => {
	it('a transform that throws is said with reshape_pass_failed, and its error still goes up (gen 10, seed 10)', async () => {
		const boom = new Error('boom');
		const pass = await pass_of(() => {
			throw boom;
		});
		await expect(pass.document(page, { csr: false, answer: false })).rejects.toBe(boom);
		await expect(pass.region('<demo-card><i>ok</i></demo-card>')).rejects.toBe(boom);
		expect(said('reshape_pass_failed')).toHaveLength(2);
	});

	it("a transform that drops ogygia's marks from a host it will restore is said with reshape_marks_lost (gen 10, seed 5)", async () => {
		const pass = await pass_of(strips);
		await pass.document(page, { csr: false, answer: false });
		await pass.region('<demo-card><i>ok</i></demo-card>');
		expect(said('reshape_marks_lost')).toHaveLength(2);
	});

	it('a transform that keeps the marks, or has no host to keep them on, says nothing', async () => {
		const pass = await pass_of(renders);
		await pass.document(page, { csr: false, answer: false });
		await pass.region('<demo-card><i>ok</i></demo-card>');
		await pass.region('<p>no custom element</p>');
		const plain = await pass_of(strips);
		await plain.document(doc('<p>no custom element</p>'), { csr: false, answer: false });
		expect(said('reshape_marks_lost')).toHaveLength(0);
		expect(said('reshape_pass_failed')).toHaveLength(0);
	});
});
