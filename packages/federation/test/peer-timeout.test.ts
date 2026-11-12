// A hop's timeout runs on the realm's timers (the `timers` port), so a simulated run owns it. A raw
// `AbortSignal.timeout` ran on the host's own clock: a seeded run of a federated app did not replay.
import { afterEach, expect, it, vi } from 'vitest';
import { PeerHandle } from '../src/peer.ts';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("a hop the peer never answers gives up after its timeout, on the realm's timers", async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	vi.stubGlobal(
		'fetch',
		(_url: unknown, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				const signal = init?.signal;
				signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
			})
	);
	const peer = new PeerHandle('cms', { origin: 'https://peer.example.com', timeout: 50 }, 'shell');
	let outcome: unknown = 'waiting';
	void peer.doc('/x', '').then(
		() => (outcome = 'answered'),
		(e: unknown) => (outcome = (e as { status?: number }).status)
	);
	await vi.advanceTimersByTimeAsync(49);
	expect(outcome).toBe('waiting');
	await vi.advanceTimersByTimeAsync(1);
	// (the section is temporarily unavailable)
	expect(outcome).toBe(504);
});
