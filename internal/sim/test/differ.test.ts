// THE DIFFERENTIAL (src/differ.ts): the simulator's run and a real browser's, compared look by look.
// What differs between the two worlds by construction (an origin, a content hash, a hole's expiry
// from its server's clock) is no difference; what the visitor would see or the network carry is.
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { ear, snapshot, type Observed, type TabSeen } from '@ogygia/tooling/e2e/sim-observe.ts';
import { compare, differences, plain, report, steps_of } from '../src/differ.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tab = (over: Partial<TabSeen> = {}): TabSeen => ({
	url: 'https://app.test/',
	dom: '<html>',
	moves: '',
	heard: [],
	said: [],
	...over
});

const run = (by: string, tabs: TabSeen[], requests: string[] = []): Observed => ({
	app: 'palaestra',
	seed: 1,
	plan: { actions: [] },
	by,
	seen: [{ after: 'first load', tabs, requests }]
});

describe('the differential', () => {
	it('an origin, a content hash and a hole expiry and signature are no difference', () => {
		expect(plain('https://app.test/_app/immutable/chunks/GJfZijeJ.js')).toBe(
			plain('http://localhost:3151/_app/immutable/chunks/AbCd_e-1.js')
		);
		expect(plain('/__ogygia__?id=ab&exp=1767229200&v=3&sig=b1a28012b0f9415d')).toBe(
			plain('/__ogygia__?id=ab&exp=1794510000&v=3&sig=6ce451b8f65fad81')
		);
		expect(plain('/__ogygia__?id=ab')).not.toBe(plain('/__ogygia__?id=cd'));
	});

	it('machine steps are compared by machine name, its instances counted', () => {
		const { steps, rest } = steps_of(`wake#1 cold -> armed
wake#2 cold -> armed
wake#1 armed -> waking`);
		expect([...steps]).toEqual(['wake cold -> armed', 'wake armed -> waking']);
		expect(rest.get('wake waking')).toBe(1);
		expect(rest.get('wake armed')).toBe(1);
	});

	it('a step, an event or a request only one side has is a difference; the same ones in another order of regions is not', () => {
		const sim = run(
			'sim',
			[
				tab({
					moves: 'hydrate-drain#1 idle -> waiting',
					heard: [
						'@doc /',
						'DOMContentLoaded interactive document',
						'ogygia:hydrated complete <a>',
						'ogygia:hydrated complete <b>'
					]
				})
			],
			['0 GET /_app/immutable/chunks/AAAAAAAA.js', '0 GET /_app/immutable/chunks/AAAAAAAA.js']
		);
		const real = run(
			'chromium',
			[
				tab({
					url: 'http://localhost:3151/',
					heard: [
						'@doc /',
						'DOMContentLoaded interactive document',
						'load complete document',
						'ogygia:hydrated complete <b>',
						'ogygia:hydrated complete <a>'
					]
				})
			],
			['0 GET /_app/immutable/chunks/BBBBBBBB.js']
		);
		const found = differences('p', sim, real).map((d) => `${d.kind}: ${d.what}`);
		expect(found).toEqual([
			'heard: only the browser heard load complete document',
			'steps: only the simulator took hydrate-drain idle -> waiting',
			'rest: a machine left in hydrate-drain waiting: sim 1, real 0',
			'requests: only the simulator asked for GET /_app/immutable/chunks/<h>.js'
		]);
	});

	it('a difference every browser shows is the simulator’s; one some show is the engines’', () => {
		const dir = mkdtempSync(join(tmpdir(), 'differ-'));
		const write = (name: string, o: Observed) => writeFileSync(join(dir, name), JSON.stringify(o));
		write('p-1.sim.json', run('sim', [tab()]));
		write('p-1.sim.chromium.json', run('chromium', [tab({ heard: ['load complete document'] })]));
		write(
			'p-1.sim.firefox.json',
			run('firefox', [tab({ heard: ['load complete document'], said: ['warn: an engine'] })])
		);
		const c = compare(dir);
		expect(c.browsers).toEqual(['chromium', 'firefox']);
		const text = report(c);
		expect(text).toMatch(/## sim-only \(1\)[^#]*only the browser heard load complete document/);
		expect(text).toMatch(/## engines \(1\)[^#]*only the browser said warn: an engine/);
	});

	it('the ear hears a document’s lifecycle and the snapshot reads it as a browser’s player does', () => {
		const w = new Window({ url: 'https://app.test/' });
		const heard: string[] = [];
		(w as unknown as { __sim_heard: (l: string) => void }).__sim_heard = (l) => heard.push(l);
		ear(w);
		w.document.write(
			'<html><head><title>T</title><link rel="modulepreload" href="/a.js"></head><body><p data-sim-x="1" style="">at 12:00:04 AM</p><script>1</script></body></html>'
		);
		w.dispatchEvent(new w.Event('popstate'));
		expect(heard[0]).toBe('@doc /');
		expect(heard).toContain('popstate interactive window');
		expect(snapshot(w.document as unknown as Document)).toBe(`title: T
<html>
  <head>
    <title>
      "T"
  <body>
    <p>
      "at <time>"`);
		w.close();
	});
});
