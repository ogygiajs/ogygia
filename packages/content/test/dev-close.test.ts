// The content plugin's dev run ends with its dev server: a real Vite dev server, a content edit
// the plugin is still waiting on (its debounce), and the server closed (a restart, a quit) inside
// that wait. Nothing of the closed run may act afterwards: no reload sent, no module graph
// invalidated, no "sources changed" line logged for a server that is gone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevApp } from './_dev-app.ts';

let app: DevApp | null = null;
afterEach(async () => {
	await app?.close();
	app = null;
});

const DEBOUNCE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the content plugin in dev, when its server closes', { timeout: 30_000 }, () => {
	it('lets go of a reload it was still waiting to send', async () => {
		app = new DevApp('og-content-dev-close-');
		const srv = await app.start(DEBOUNCE_MS);
		const logged = vi.spyOn(srv.config.logger, 'info');
		const sent = vi.spyOn(srv.ws, 'send');

		// the edit lands: the plugin waits DEBOUNCE_MS before it reloads
		await app.edit('src/content/a.md', '# A, edited');
		await srv.close();
		await sleep(DEBOUNCE_MS * 3);

		expect(
			logged.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('sources changed'))
		).toEqual([]);
		expect(sent).not.toHaveBeenCalled();
	});

	it('a restart ends the old run only: the new server still reloads on an edit', async () => {
		app = new DevApp('og-content-dev-close-');
		const srv = await app.start(DEBOUNCE_MS);
		// (the new server is made, with this same plugin, before the old one closes)
		await srv.restart();
		const sent = vi.spyOn(srv.ws, 'send');

		await app.edit('src/content/a.md', '# A, edited');
		const until = Date.now() + 5_000;
		while (sent.mock.calls.length === 0 && Date.now() < until) await sleep(20);

		expect(sent).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
	});

	it('still reloads on an edit while the server runs', async () => {
		app = new DevApp('og-content-dev-close-');
		const srv = await app.start(DEBOUNCE_MS);
		const sent = vi.spyOn(srv.ws, 'send');

		await app.edit('src/content/a.md', '# A, edited');
		const until = Date.now() + 5_000;
		while (sent.mock.calls.length === 0 && Date.now() < until) await sleep(20);

		expect(sent).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
	});
});
