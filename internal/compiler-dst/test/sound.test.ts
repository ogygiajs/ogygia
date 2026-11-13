// SOUND ANALYSES: what a component really reads of `page.data` is within what seed shaping
// predicted for it ('all' predicts every key). A key read but not predicted is a value the island is
// never sent. A failure prints the shrunk reads.
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { page_data_keys_answer } from '../../../packages/compiler/src/compiler/link/page-keys.ts';
import { component, read, really_read } from '../src/reads.ts';

const RUNS = (ci: number) => Number(process.env.DST_RUNS) || ci;

describe('seed shaping is sound', () => {
	test("a component's page.data reads are within the predicted keys", async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(read, { minLength: 1, maxLength: 4 }), async (reads) => {
				const source = component(reads);
				const { keys } = page_data_keys_answer(source, '/app/src/lib/Reads.svelte', 'svelte');
				if (keys === 'all') return;
				const predicted = keys ?? new Set<string>();
				const missed = [...(await really_read(source))].filter((k) => !predicted.has(k));
				expect({ source, missed }).toEqual({ source, missed: [] });
			}),
			{ numRuns: RUNS(40) }
		);
	});
});
