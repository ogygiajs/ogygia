import { describe, expect, it } from 'vitest';
import { BUFFER, install_timeline, record_download } from '../src/timeline.ts';

/** A document's window as the timeline needs it: its tasks run when `run()` is called. */
function fake_window() {
	const tasks: (() => void)[] = [];
	const w = {
		setTimeout: (fn: () => void) => tasks.push(fn),
		performance: { now: () => 10 },
		run: () => tasks.splice(0).forEach((t) => t())
	};
	install_timeline(w);
	type Observer = new (cb: (list: { getEntries(): object[] }) => void) => {
		observe(o: object): void;
		disconnect(): void;
	};
	return { w, PO: (w as unknown as { PerformanceObserver: Observer }).PerformanceObserver };
}

describe('a simulated document resource timing', () => {
	it('under status (Chromium, Firefox) a dropped download has an entry with status 0', () => {
		const { w, PO } = fake_window();
		const seen: object[] = [];
		new PO((l) => seen.push(...l.getEntries())).observe({ type: 'resource', buffered: true });
		record_download(w, 'status', 'https://app.test/a.js', 200, 0);
		record_download(w, 'status', 'https://app.test/b.js', null, 0);
		expect(seen).toEqual([]);
		w.run();
		expect(seen).toMatchObject([
			{ name: 'https://app.test/a.js', responseStatus: 200 },
			{ name: 'https://app.test/b.js', responseStatus: 0, responseStart: 0 }
		]);
	});

	it('under start (WebKit) a dropped download has no entry and none has a status', () => {
		const { w, PO } = fake_window();
		const seen: object[] = [];
		new PO((l) => seen.push(...l.getEntries())).observe({ type: 'resource' });
		record_download(w, 'start', 'https://app.test/a.js', 404, 0);
		record_download(w, 'start', 'https://app.test/b.js', null, 0);
		w.run();
		expect(seen).toHaveLength(1);
		expect(seen[0]).not.toHaveProperty('responseStatus');
		expect(seen[0]).toMatchObject({ name: 'https://app.test/a.js', responseStart: 10 });
	});

	it('a buffered observer hears the first entries the buffer kept, a later one only what comes', () => {
		const { w, PO } = fake_window();
		for (let i = 0; i < BUFFER + 5; i++)
			record_download(w, 'status', `https://app.test/${i}.js`, 200, 0);
		const buffered: object[] = [];
		const plain: object[] = [];
		new PO((l) => buffered.push(...l.getEntries())).observe({ type: 'resource', buffered: true });
		new PO((l) => plain.push(...l.getEntries())).observe({ type: 'resource' });
		w.run();
		expect(buffered).toHaveLength(BUFFER);
		expect(plain).toHaveLength(0);
		record_download(w, 'status', 'https://app.test/late.js', 200, 0);
		w.run();
		expect(buffered).toHaveLength(BUFFER + 1);
		expect(plain).toHaveLength(1);
	});
});
