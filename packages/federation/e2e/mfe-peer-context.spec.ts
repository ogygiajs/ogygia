// A PEER PAGE'S CROSS-ISLAND CONTEXT, MOUNTED IN A SHELL WITH NONE OF ITS OWN (#1931) — end to end.
//
// The cms page `/cms/theme` sets a context value server-side (`setTheme`) that its island reads
// (`getTheme`). The shell's own code provides no context, so a production build of the shell left
// the context bridge out, and the cms island mounted there could not read its value: it never came
// alive. A federated page carries regions its build never saw, so it ships what a peer region
// can need.
//
// Servers: the `mfe` worker fixture (three servers from examples/mfe, throwaway keys).
import { test, expect } from './mfe.ts';

for (const door of ['cms', 'shell'] as const)
	test(`a cms island reads the context its page set, on the ${door}'s door`, async ({
		page,
		mfe
	}) => {
		await page.goto(`${mfe.origin(door)}/cms/theme`);
		const probe = page.getByTestId('theme-probe');
		await expect(probe).toHaveText('ocean: 0', { timeout: 60_000 });
		await expect(page.locator('ogygia-region[data-hydrated]').filter({ has: probe })).toHaveCount(
			1,
			{ timeout: 60_000 }
		);
		await probe.click();
		await expect(probe).toHaveText('ocean: 1');
	});
