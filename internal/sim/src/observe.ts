/**
 * THE DIFFERENTIAL, THE SIMULATOR'S SIDE: what the visitor saw after an action, read as the
 * real-browser player reads it (@ogygia/tooling/e2e/sim-observe.ts), so `src/differ.ts` can put
 * the two side by side.
 */
import { snapshot, type Seen } from '@ogygia/tooling/e2e/sim-observe.ts';
import type { Visitor } from './browser.ts';
import { ORIGIN, type World } from './world.ts';

/** Every tab of `v` now, and the requests its tabs made to the app since exchange `since`. */
export function observe(world: World, v: Visitor, after: string, since: number): Seen {
	const requests: string[] = [];
	for (const e of world.network.exchanges.slice(since)) {
		const tab = /^tab-(\d+)#/.exec(e.from);
		const u = new URL(e.url);
		if (tab === null || u.origin !== ORIGIN) continue;
		requests.push(`${Number(tab[1]) - 1} ${e.method} ${u.pathname}${u.search}`);
	}
	return {
		after,
		tabs: v.tabs.map((t) => {
			const doc = t.page.mainFrame.document as unknown as Document;
			return {
				url: t.page.mainFrame.url,
				dom: snapshot(doc),
				moves: (t.moves_by.get(t.realm)?.() ?? '').trim(),
				heard: t.lifecycle.splice(0),
				said: [...t.errors, ...t.console].map((l) => l.split('\n')[0])
			};
		}),
		requests
	};
}
