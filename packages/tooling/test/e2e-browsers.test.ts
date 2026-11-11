// The engine helpers for e2e specs: a console message's text the same in every engine, and the
// page errors a spec holds to the same bar in every engine.
import { describe, expect, it } from 'vitest';
import type { ConsoleMessage, Page } from '@playwright/test';
import { console_text, page_errors } from '../src/e2e/browsers.ts';

function fake_page(engine: string) {
	const handlers: ((e: Error) => void)[] = [];
	const page = {
		context: () => ({ browser: () => ({ browserType: () => ({ name: () => engine }) }) }),
		on: (event: string, cb: (e: Error) => void) => {
			if (event === 'pageerror') handlers.push(cb);
		}
	} as unknown as Page;
	const emit = (message: string, stack: string) => {
		const e = new Error(message);
		e.stack = stack;
		for (const h of handlers) h(e);
	};
	return { page, emit };
}

// WebKit's line for a fetch that failed at the network, as Playwright hands it over: the message is
// cut at the URL's `http:`, the stack's first line is the whole line.
const URL_LINE = 'Fetch API cannot load http://localhost:4173/x due to access control checks.';
const network_failure = (emit: (m: string, s: string) => void) =>
	emit('Fetch API cannot load http', `${URL_LINE}\n    at fetch@[native code]`);

describe('page_errors', () => {
	it("leaves out WebKit's line for a fetch that failed at the network, read from the stack's first line", () => {
		const { page, emit } = fake_page('webkit');
		const errors = page_errors(page);
		network_failure(emit);
		emit('boom', 'Error: boom\n    at x');
		expect(errors).toEqual(['boom']);
	});

	it('keeps that line in Chromium and Firefox', () => {
		for (const engine of ['chromium', 'firefox']) {
			const { page, emit } = fake_page(engine);
			const errors = page_errors(page);
			network_failure(emit);
			expect(errors).toEqual(['Fetch API cannot load http']);
		}
	});
});

describe('console_text', () => {
	const message = (values: unknown[], text = 'serialized') =>
		({
			args: () =>
				values.map((v) => ({
					evaluate: async (fn: (v: unknown) => string) => {
						if (v === GONE) throw new Error('Target page, context or browser has been closed');
						return fn(v);
					}
				})),
			text: () => text
		}) as unknown as ConsoleMessage;
	const GONE = Symbol('gone');

	it("joins each argument's own text, an Error as its name and message", async () => {
		expect(await console_text(message(['a', 2, new TypeError('bad')]))).toBe('a 2 TypeError: bad');
	});

	it('reads an argument of a page that left as empty text, without throwing', async () => {
		expect(await console_text(message(['a', GONE]))).toBe('a ');
	});

	it("falls back to Playwright's text when the message has no arguments", async () => {
		expect(await console_text(message([], 'plain'))).toBe('plain');
	});
});
