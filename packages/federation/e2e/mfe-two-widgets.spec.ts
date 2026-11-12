// TWO DEFERRED PEER WIDGETS ON ONE PAGE — end to end, in a real browser (#914).
//
// The shell's `/two-widgets` page holds two deferred dash `kpis` widgets, alike but for their props.
// Each hole is its own request, so each shows its own answer. Their endpoints have no `id`, and the
// frame store once gave both the address of the bare path: one answer landed in both.
//
// Servers: the `mfe` worker fixture (three `vite dev` servers from examples/mfe, throwaway keys).
import { test, expect } from './mfe.ts';

test.describe('two deferred peer widgets on one page', () => {
	test('each shows its own answer', async ({ page, mfe }) => {
		await page.goto(mfe.origin('shell') + '/two-widgets');
		await expect(page.getByTestId('shell-later')).toHaveText('later, shell', { timeout: 60_000 });
		await expect(page.getByTestId('widget-acme').locator('h2')).toHaveText('Dashboard · acme', {
			timeout: 60_000
		});
		await expect(page.getByTestId('widget-globex').locator('h2')).toHaveText('Dashboard · globex');
	});
});
