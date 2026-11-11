// devalue's download that fails (runtime/devalue-lane.ts): it is tried again at once, a failure is
// never kept (the next read loads it afresh), and a read that runs once asks again later.
//
// Its own file: whether devalue is loaded is module state shared by a file's tests (one test here).
import { expect, test, vi } from 'vitest';

/** The downloads to fail before one lands, and how many were asked for. */
const net = vi.hoisted(() => ({ fail: 0, asked: 0 }));
vi.mock('../../src/runtime/import-again.ts', () => ({
	import_again: (load: () => Promise<unknown>) => () => {
		net.asked++;
		return net.fail-- > 0 ? Promise.reject(new TypeError('dropped')) : load();
	}
}));

const { load_devalue, with_devalue } = await import('../../src/runtime/devalue-lane.ts');

test('a dropped download is tried again at once, its failure is not kept, and a read that runs once asks again later', async () => {
	net.fail = 2;
	await expect(load_devalue()).rejects.toThrow('dropped');
	expect(net.asked, 'the first try and one again at once').toBe(2);

	vi.useFakeTimers();
	try {
		net.fail = 2;
		const seen: unknown[] = [];
		with_devalue(({ parse }) => seen.push(parse('[1]')));
		await vi.advanceTimersByTimeAsync(0);
		expect(net.asked, 'the failure was not kept: the read asked afresh').toBe(4);
		expect(seen).toEqual([]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(net.asked, 'asked again a second later').toBe(5);
		await load_devalue(); // (joins that download: the module itself loads for real)
		await Promise.resolve();
		expect(seen).toEqual([1]);
	} finally {
		vi.useRealTimers();
	}
});
