// SIMULATION of one address in the frame store (src/runtime/frame-store.ts), written by every channel
// that answers it: a hole's own fetch, a forced refresh (a lake's revalidate, a re-minted hole), and
// a batch's part (a navigation's or the page's batch, src/runtime/frame-nav.ts). Each request is
// answered with the HTML of its turn (the server's state when the request reached it), when the
// scheduler says. The rule is the batches one: an answer may only land ahead of an earlier pending
// one, never be painted over by it. What a region bound there sees only ever moves forward in the
// order its requests went out, whatever order the answers come back in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { STALE } from '@ogygia/machine';
import { _reset, ensure, subscribe } from '../_frames.ts';
import { streamFrames } from '../../src/runtime/frame-nav.ts';
import { frameAddress } from '../../src/frame.ts';
import { done_parcel } from '../../src/server/stream-regions.ts';
import { server_rules_hold } from './_server.ts';

const ENDPOINT = 'http://localhost/__ogygia__?id=simorder0001&props=W3t9XQ&exp=9999999999&sig=so';
const ADDRESS = frameAddress(ENDPOINT);

type Step = 'fetch' | 'refresh' | 'batch' | 'wait';

// (the page's origin: a batch posts only to a region endpoint of this origin, src/runtime/html-sink.ts)
beforeEach(() => vi.stubGlobal('location', new URL('http://localhost/page')));
afterEach(() => {
	_reset();
	vi.unstubAllGlobals();
});

describe('one address, every channel, simulated', () => {
	it('what is on screen moves forward in the order the requests went out', async () => {
		await simulate.check(
			[
				fc.array(fc.constantFrom<Step>('fetch', 'refresh', 'refresh', 'batch', 'batch', 'wait'), {
					minLength: 2,
					maxLength: 6
				})
			],
			async (sim, steps) => {
				_reset();
				server_rules_hold(sim);
				// every request is answered with its own turn: the n-th request out shows `r<n>`
				sim.fetch((request, n) => {
					const html = `<p data-r="${n}">r${n}</p>`;
					if (request.method === 'POST')
						return new Response(
							`<template data-ogygia-slot="so">${html}</template>${done_parcel()}`,
							{ headers: { 'content-type': 'text/html' } }
						);
					return new Response(html, { headers: { 'content-type': 'text/html' } });
				});
				const fetcher = async (signal: AbortSignal) => (await fetch(ENDPOINT, { signal })).text();
				const turn = (html: string) => Number(/data-r="(\d+)"/.exec(html)?.[1] ?? -1);

				/** what a region bound at the address was shown, in order */
				const shown: number[] = [];
				const off = subscribe(ADDRESS, (f) => shown.push(turn(f.html)));
				sim.always('an older answer never paints over a newer one', () => {
					for (let i = 1; i < shown.length; i++)
						if (shown[i] <= shown[i - 1])
							return `shown r${shown[i - 1]}, then r${shown[i]} (shown: ${shown.map((r) => `r${r}`).join(', ')})`;
					return null;
				});

				await sim.play(
					steps.map((step): readonly [string, () => unknown] => {
						if (step === 'wait')
							return ['1 s passes', () => new Promise((r) => setTimeout(r, 1000))];
						if (step === 'batch')
							return ['a batch asks for the address', () => streamFrames([ENDPOINT], 'nav')];
						return [
							step === 'refresh' ? 'a forced refresh' : 'a hole fetches',
							// (a hole's failure is its own to retry; this run checks what lands)
							() => ensure(ADDRESS, fetcher, { force: step === 'refresh' }).catch(() => STALE)
						];
					})
				);
				sim.finally('stop watching', () => (off(), null));
			},
			// (four batches that each sit out their 10 s stall are past a shorter horizon)
			{ runs: 200 }
		);
	});
});

describe('one address: the orderings the simulation found', () => {
	it('a batch asked before a refresh, answering after it, does not paint its older answer over the refresh', async () => {
		const answers: Array<(html: string) => void> = [];
		const was = globalThis.fetch;
		globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((resolve) =>
				answers.push((html) =>
					resolve(
						new Response(
							init?.method === 'POST'
								? `<template data-ogygia-slot="so">${html}</template>${done_parcel()}`
								: html
						)
					)
				)
			)) as typeof fetch;
		try {
			const shown: string[] = [];
			const off = subscribe(ADDRESS, (f) => shown.push(f.html));
			const batch = streamFrames([ENDPOINT], 'nav'); // asked first: the older answer
			const refresh = ensure(
				ADDRESS,
				async (signal) => (await fetch(ENDPOINT, { signal })).text(),
				{ force: true }
			);
			answers[1]('new'); // the refresh answers first
			expect(await refresh).toBe('new');
			answers[0]('old'); // then the batch
			await batch;
			off();
			expect(shown).toEqual(['new']);
		} finally {
			globalThis.fetch = was;
		}
	});
});
