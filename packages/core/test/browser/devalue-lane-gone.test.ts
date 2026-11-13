// devalue's download that never lands (runtime/devalue-lane.ts): a read that runs once (a streamed
// value's resolver) is told when its last try failed, so what it serves can settle instead of
// waiting forever.
//
// Its own file: whether devalue is loaded is module state shared by a file's tests.
import { expect, test, vi } from 'vitest';

/** Every download fails, as on a network that lost devalue's file. */
vi.mock('../../src/runtime/import-again.ts', () => ({
	import_again: () => () => Promise.reject(new TypeError('dropped'))
}));

const { with_devalue } = await import('../../src/runtime/devalue-lane.ts');

test('a read that runs once, whose download failed every time, is told it never will', async () => {
	vi.useFakeTimers();
	try {
		const told: unknown[] = [];
		with_devalue(
			() => told.push('ran'),
			(error) => told.push(error)
		);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(told).toHaveLength(1);
		expect(String(told[0])).toContain('dropped');
	} finally {
		vi.useRealTimers();
	}
});
