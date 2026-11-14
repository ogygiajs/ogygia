import { expect, test } from 'vitest';
import { flushSync, mount, unmount, type Component, type Snippet } from 'svelte';
import HeldPromiseHost from './fixtures/HeldPromiseHost.svelte';
import type { RegionValue } from '../../src/region.ts';

type Held = Component<{ of: Promise<RegionValue>; placeholder?: Snippet }>;
type Reached = { kind: 'error' | 'unhandledrejection'; reason: unknown };
type Host = { hide: () => boolean };

class HeldPromiseFailure {
	readonly reached: Reached[] = [];
	readonly error: Error = new Error('the query failed');
	readonly #target: HTMLElement = document.body.appendChild(document.createElement('div'));
	readonly #query = Promise.withResolvers<never>();
	#app: Host | undefined;
	readonly #on_error = (e: ErrorEvent): void => {
		this.reached.push({ kind: 'error', reason: e.error });
		e.preventDefault();
	};
	readonly #on_rejection = (e: PromiseRejectionEvent): void => {
		this.reached.push({ kind: 'unhandledrejection', reason: e.reason });
		e.preventDefault();
	};

	get text(): string {
		return this.#target.textContent ?? '';
	}

	async run(held: Held, boundary: boolean, leave: boolean): Promise<void> {
		window.addEventListener('error', this.#on_error);
		window.addEventListener('unhandledrejection', this.#on_rejection);
		try {
			this.#app = mount(HeldPromiseHost, {
				target: this.#target,
				props: { held, of: this.#query.promise, boundary }
			}) as Host;
			flushSync();
			await new Promise((r) => setTimeout(r, 20));
			if (leave) {
				this.#app.hide();
				flushSync();
			}
			this.#query.reject(this.error);
			await new Promise((r) => setTimeout(r, 100));
		} finally {
			window.removeEventListener('error', this.#on_error);
			window.removeEventListener('unhandledrejection', this.#on_rejection);
		}
	}

	async end(): Promise<void> {
		if (this.#app) await unmount(this.#app);
		this.#target.remove();
	}
}

export function held_promise_failure_suite(held: Held): void {
	test('a held region whose promise rejects: the nearest <svelte:boundary> shows the error', async () => {
		const failure = new HeldPromiseFailure();
		await failure.run(held, true, false);
		expect(failure.text).toBe('the query failed');
		expect(failure.reached).toEqual([]);
		await failure.end();
	});

	test('a held region whose promise rejects with no boundary: the page gets its own error as an unhandled rejection, once', async () => {
		const failure = new HeldPromiseFailure();
		await failure.run(held, false, false);
		expect(failure.reached.map((r) => r.kind)).toEqual(['unhandledrejection']);
		expect(failure.reached[0]!.reason).toBe(failure.error);
		await failure.end();
	});

	test('a held region that left the page before its promise rejected: nothing reaches the page', async () => {
		const failure = new HeldPromiseFailure();
		await failure.run(held, true, true);
		expect(failure.reached).toEqual([]);
		await failure.end();
	});
}
