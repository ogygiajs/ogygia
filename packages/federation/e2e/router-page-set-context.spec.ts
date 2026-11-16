// A SERVER-ROUTER PAGE THAT SETS A CONTEXT WITH `createContext`'S SETTER (#1974): the cms page
// `/cms/theme-set` calls `setTheme('forest')` in its own script, and its island reads `getTheme()`.
// `<Provide>` in the same place reaches the island (mfe-peer-context.spec.ts); the setter must too.
//
// Servers: the `mfe` worker fixture (three servers from examples/mfe, throwaway keys).
import { test, expect } from './mfe.ts';

for (const door of ['cms', 'shell'] as const)
	test(`a cms island reads the context its router page set, on the ${door}'s door`, async ({
		page,
		mfe
	}) => {
		await page.goto(`${mfe.origin(door)}/cms/theme-set`);
		const probe = page.getByTestId('set-theme-probe');
		await expect(probe).toHaveText('forest: 0', { timeout: 60_000 });
		await expect(page.locator('ogygia-region[data-hydrated]').filter({ has: probe })).toHaveCount(
			1,
			{ timeout: 60_000 }
		);
		await probe.click();
		await expect(probe).toHaveText('forest: 1');
	});
