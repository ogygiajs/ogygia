// A LIVE REGION ANNOUNCES WHAT IT SHOWS: the simulator hears each document's `ogygia:hydrated` and
// `ogygia:live` as an app's own listener on the document does (bubbling, never capturing: an event
// sent without `bubbles` is one no app hears), and what the region showed then. Mutation testing:
// a keep-alive tick, and an island's mount, announced to nobody survived every oracle (core.ts, gen
// 196). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { live_events } from '../src/oracles.ts';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe.skipIf(!built)('region events', () => {
	it("hears an interactive live region's mount and every tick after it, and a static one's ticks", async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/live-partial');
			await world.quiesce(8_000);
			const doc = tab.page.mainFrame.document as unknown as Document;
			const stat = doc.querySelector('[data-live-interactive] ogygia-region')!;
			const badge = doc.querySelector('[data-live-static] ogygia-region')!;
			const said = (el: Element) => (tab.heard.get(el) ?? []).map((h) => h.type);
			// (mounted once, then kept alive: a tick a second)
			expect(said(stat).filter((t) => t === 'ogygia:hydrated')).toHaveLength(1);
			expect(said(stat).filter((t) => t === 'ogygia:live').length).toBeGreaterThan(3);
			expect(said(badge)).not.toContain('ogygia:hydrated');
			expect(said(badge).filter((t) => t === 'ogygia:live').length).toBeGreaterThan(3);
			// (each heard with the tick it showed: the last one is what is on screen)
			expect(tab.heard.get(stat)!.at(-1)!.shown).toContain(
				stat.querySelector('[data-stat-value]')!.textContent
			);
			expect(live_events(tab, world)).toBeNull();
		} finally {
			await world.end();
		}
	}, 120_000);
});
