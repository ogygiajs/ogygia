/**
 * The autopilot's probe recorder (src/autopilot.ts), a setup file it adds to each test project of the
 * package it runs. A probed source calls `globalThis.__ogygia_autopilot(id)` on a failure site's
 * recovery path; each test's calls go to the run's reporter (src/autopilot-reporter.ts) as one
 * console line after the test, under the test's id. Console lines reach the reporter from node and
 * browser projects alike.
 */
import { afterEach, beforeEach } from 'vitest';

const hits = new Set<string>();
const say = console.log.bind(console);
(globalThis as { __ogygia_autopilot?: (id: string) => void }).__ogygia_autopilot = (id) => {
	hits.add(id);
};

beforeEach(() => {
	hits.clear();
});

afterEach((ctx) => {
	if (hits.size === 0) return;
	say(
		JSON.stringify({
			ogygia_autopilot: { test: ctx.task.id, hits: [...hits] }
		})
	);
	hits.clear();
});
