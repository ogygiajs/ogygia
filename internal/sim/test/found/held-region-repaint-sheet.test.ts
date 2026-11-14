// FOUND BY THE SIMULATOR (gen 25: unstyled-region on /p3, "no rules for svelte-4flyj5", on every
// seed that shows /p3). /p3's island (n15) holds a styled held region (n14) the server baked with
// its sheet inside it. The island reads the held region's query again once it hydrates, and the
// repaint lost the sheet: the answer's link was lifted to the head only when no link of that href
// was in the document, the one inside the region counted, and the morph then took that one out.
// (Needs the app built for the simulator: `node src/gen.ts --seed 25`, then
// `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';

const APP = fileURLToPath(new URL('../../../../apps/sim-gen', import.meta.url));
const OUTPUT = `${APP}/.svelte-kit/sim-builds/v1`;
const GEN = 25;
const ready = ((): boolean => {
	if (!existsSync(`${OUTPUT}/server/index.js`)) return false;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

/** The rules of every stylesheet and `<style>` in the document, joined. */
function rules(doc: Document): string {
	const css: string[] = [];
	for (const s of doc.querySelectorAll('style')) css.push(s.textContent ?? '');
	for (const l of doc.querySelectorAll('link[rel~="stylesheet"]'))
		for (const r of (l as HTMLLinkElement).sheet?.cssRules ?? []) css.push(r.cssText);
	return css.join('\n');
}

describe.skipIf(!ready)('found: a held region repainted inside an island keeps its sheet', () => {
	it("the held region's scoped rules are in the document once the island and its query settle", async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/p3');
			await world.rest();
			const doc = tab.page.mainFrame.document as unknown as Document;
			const held = doc.querySelector('[data-gen="held-host"] [data-gen="held"]');
			expect(held).not.toBeNull();
			const scoped = [...held!.classList].filter((c) => c.startsWith('svelte-'));
			expect(scoped.length).toBe(1);
			expect(rules(doc)).toContain(`.${scoped[0]}`);
		} finally {
			await world.end();
		}
	}, 120_000);
});
