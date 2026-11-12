// A profiler window id: the check every request of a window's session makes before its row is
// written to the shared store, and the mint at the window's start. The HMAC is node:crypto's; this
// counts the profiler's own steps around it (the capability's message, token and checks).
import { bench } from '@bench/heisenbench/bench';
import { window_ids } from '../src/profiler/window-id.ts';

const SECRET = 'a-profiler-secret-of-32-bytes-ok';

bench('window id: mint one at a window start', ({ ids }) => ids.mint().length, {
	setup: () => ({ ids: window_ids(SECRET, false, 'profiler:/__profiler')! })
});

bench(
	'window id: check the requests of a window (live, forged, absent)',
	({ ids, sent }) => {
		let ok = 0;
		for (const raw of sent) if (ids.check(raw) !== null) ok++;
		return ok;
	},
	{
		setup: () => {
			const ids = window_ids(SECRET, false, 'profiler:/__profiler')!;
			const live = ids.mint();
			const forged = live.slice(0, -2) + 'AA';
			const sent: (string | null)[] = [];
			for (let i = 0; i < 30; i++) sent.push(i % 3 === 0 ? forged : i % 3 === 1 ? null : live);
			return { ids, sent };
		},
		scale: (ctx, k) => ({ ...ctx, sent: Array.from({ length: k }, () => ctx.sent).flat() })
	}
);
