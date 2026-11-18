/**
 * Kit's client remote functions (`__sveltekit/remote`), served to the browser in their place: the
 * same exports, with each query maker's call (`query`, `query.batch`, `query.live`) run as a
 * {@link new_reader}, so the cache can tell a new reader from a departed island's own proxies.
 */
import * as kit from '__sveltekit/remote';
import { new_reader } from './remote-cache.ts';

export * from '__sveltekit/remote';

type QueryMaker = (id: string) => (...args: unknown[]) => unknown;

function read_new(make: QueryMaker): QueryMaker {
	return (id) => {
		const kits = make(id);
		const call = (...args: unknown[]): unknown => new_reader(() => kits(...args));
		for (const key of Reflect.ownKeys(kits)) {
			if (key === 'length' || key === 'name') continue;
			Object.defineProperty(call, key, Reflect.getOwnPropertyDescriptor(kits, key)!);
		}
		return call;
	};
}

export const query: QueryMaker = read_new(kit.query);
export const query_batch: QueryMaker = read_new(kit.query_batch);
export const query_live: QueryMaker = read_new(kit.query_live);
