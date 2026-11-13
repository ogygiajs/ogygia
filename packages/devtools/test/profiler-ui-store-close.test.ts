/**
 * The profiler's browser store (profiler/ui/store.ts) owns each IndexedDB connection it opens for one
 * call: it closes when the call ends, whichever way. A connection left open blocks the next version
 * upgrade of the database, and the store then reads empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get_report, list_reports } from '../src/profiler/ui/store.ts';

/** An `indexedDB` whose one database counts its open connections; `transaction` does `tx`. */
function fake_idb(tx: () => unknown) {
	let open = 0;
	const db = {
		objectStoreNames: { contains: () => true },
		transaction: tx,
		close: () => void (open -= 1)
	};
	const idb = {
		open: () => {
			const req: Record<string, unknown> = { result: db };
			queueMicrotask(() => {
				open += 1;
				(req.onsuccess as () => void)();
			});
			return req;
		}
	};
	return { idb, open: () => open };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('a store call closes its connection', () => {
	it('when the transaction cannot start (it throws)', async () => {
		const fake = fake_idb(() => {
			throw new DOMException('quota', 'QuotaExceededError');
		});
		vi.stubGlobal('indexedDB', fake.idb);
		expect(await get_report('a')).toBeNull();
		expect(fake.open()).toBe(0);
	});

	it('when the work in it succeeds', async () => {
		const fake = fake_idb(() => ({
			objectStore: () => ({
				getAll: () => {
					const req: Record<string, unknown> = { result: [] };
					queueMicrotask(() => (req.onsuccess as () => void)());
					return req;
				}
			})
		}));
		vi.stubGlobal('indexedDB', fake.idb);
		expect(await list_reports()).toEqual([]);
		expect(fake.open()).toBe(0);
	});
});
