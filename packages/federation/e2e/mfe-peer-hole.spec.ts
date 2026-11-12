// A SERVER ISLAND INSIDE A PEER'S WIDGET — end to end, in a real browser (#910).
//
// dash's `holder` widget holds a server island (`render: 'deferred'`). The shell's `/peer-hole` page
// shows it twice: baked into the page, and through a deferred hole. Each island's hole is dash's
// own; the shell carries it as a hole of its own that forwards to dash, so the browser asks the
// shell's origin and gets what dash's server rendered. It once asked the shell's own islands
// endpoint, which refused it (403 foreign-key), and the fallback stood for good.
//
// Servers: the `mfe` worker fixture (three `vite dev` servers from examples/mfe, throwaway keys).
import { test, expect } from './mfe.ts';

test.describe("a server island inside a peer's widget", () => {
	test('shows its server render, baked and deferred', async ({ page, mfe }) => {
		const refused: string[] = [];
		page.on('response', (res) => {
			if (res.status() === 403) refused.push(res.url());
		});
		await page.goto(`${mfe.origin('shell')}/peer-hole`);
		await expect(page.getByTestId('dash-holder')).toHaveCount(2, { timeout: 60_000 });
		await expect(page.getByTestId('dash-later')).toHaveText(['later, baked', 'later, deferred'], {
			timeout: 60_000
		});
		await expect(page.getByTestId('dash-later-fallback')).toHaveCount(0);
		expect(refused, 'no hole was refused').toEqual([]);
	});
});
