/**
 * The server's read trace: work that may be kept (a cached hole render) runs in its own read set
 * (plugin/reads.ts), found through every await of it, so a read lands on the render that made it even
 * when one request renders many holes at once (a batch).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { current_facts } from '../plugin/facts.ts';
import { ReadSet, set_open_reads, type Reads } from '../plugin/reads.ts';

const open = new AsyncLocalStorage<Reads>();
set_open_reads(() => open.getStore());

/** Run `work` in a read set of its own, under the one running now (or the request's): what it read
 *  is in `reads` once it has settled. */
export function trace_reads<T>(work: () => T): { reads: Reads; value: T } {
	const reads = new ReadSet(open.getStore() ?? current_facts()?.reads ?? null);
	return { reads, value: open.run(reads, work) };
}
