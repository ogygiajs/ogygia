// The oracles on the palaestra build: a page at rest keeps ogygia's rules, has no errors, and
// equals a fresh hard load of its URL. (Skipped without `OGYGIA_RULES=1 vite build` there.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { KNOWN, mpa_equivalent, normalize, page_errors, page_rules } from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe('normalize', () => {
	it('drops scripts, comments, nonces and blank text; keeps attributes and text', async () => {
		const { Window } = await import('happy-dom');
		const w = new Window();
		w.document.write(
			'<html><head><title>t</title><script nonce="x">1</script></head><body>\n  <!--[--><p class="a" nonce="y">hi</p><!--]-->\n</body></html>'
		);
		expect(normalize(w.document as unknown as Document)).toBe(
			[
				'title: t',
				'<html>',
				'  <head>',
				'    <title>',
				'      "t"',
				'  <body>',
				'    <p class="a">',
				'      "hi"'
			].join('\n')
		);
	});
});

describe('KNOWN', () => {
	const region = (label: string, at = '    ') =>
		[`${at}<ogygia-region wake="load">`, `${at}  <div>`, `${at}    "${label}"`].join('\n');
	const page = (...labels: string[]) =>
		['<html>', '  <body>', ...labels.map((l) => region(l))].join('\n');
	const left = KNOWN.find((k) => k.issue === 807)!;

	it('#807 forgives a region the fresh load lacks, and nothing it has', () => {
		const [shown, fresh] = [page('twin', 'b-only'), page('b-only')];
		expect(left.applies(shown, fresh)).toBe(true);
		expect(left.forgive(shown, fresh)).toBe(fresh);
		expect(left.forgive(fresh, shown)).toBe(fresh);
	});

	it('#807 does not apply when the tab lacks a region the fresh load has', () => {
		expect(left.applies(page('twin', 'twin'), page('b-only'))).toBe(false);
	});

	const kept = KNOWN.find((k) => k.issue === 799)!;
	const head = (sheets: number) =>
		[
			'<html>',
			'  <head>',
			...Array.from({ length: sheets }, () => [
				'    <style data-ogygia-region-css="/a.css">',
				'      ".a{}"'
			]).flat(),
			'  <body>'
		].join('\n');

	it('#799 counts copies: a second copy of the same region sheet is the kept one (seeds 385, 415)', () => {
		expect(kept.applies(head(2), head(1))).toBe(true);
		expect(kept.applies(head(1), head(1))).toBe(false);
		expect(kept.applies(head(1), head(2))).toBe(false);
	});
});

describe('page errors', () => {
	const tab = (errors: string[]) =>
		({
			realm: 'tab-1#6',
			name: 'tab-1',
			documents: 6,
			errors,
			console: [],
			page: { mainFrame: { url: 'https://app.test/split-brain' } }
		}) as unknown as Parameters<typeof page_errors>[0];
	// (the document's own load is its realm's first request)
	const world = (tampered: string) =>
		({
			network: {
				exchanges: ['https://app.test/split-brain', 'https://app.test/_app/x.js'].map((url, i) => ({
					id: i + 1,
					from: 'tab-1#6',
					method: 'GET',
					url,
					status: 200,
					cut: false,
					tampered: url === tampered
				}))
			}
		}) as unknown as Parameters<typeof page_errors>[1];
	const said = ["error: Cannot read properties of undefined (reading 'toLowerCase')"];

	it('a document whose own HTML was changed on the way may say anything (seed 150)', () => {
		expect(page_errors(tab(said), world('https://app.test/split-brain'))).toBeNull();
	});

	it('a changed chunk does not excuse a TypeError', () => {
		expect(page_errors(tab(said), world('https://app.test/_app/x.js'))?.oracle).toBe('page-errors');
	});
});

describe.skipIf(!built)('oracles on the palaestra build', () => {
	it('the home page at rest: rules kept, no errors, equal to a fresh hard load', async () => {
		const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('alice');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/');
			expect(page_errors(tab)).toBeNull();
			expect(page_rules(tab)).toBeNull();
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});
});
