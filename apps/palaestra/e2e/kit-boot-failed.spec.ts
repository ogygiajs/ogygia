// A WAIT NEVER HANGS (#820). An island of ours on a page Kit hydrates (inside a hole's answer, inside a
// lake) waits for Kit to apply its page before it hydrates. When Kit's own client code fails to
// download, Kit never will: the wait must end, the island fails, and the page says why
// (`kit_boot_failed`), instead of the island waiting forever in silence.
//
// Against the built palaestra (/hole-kit-rebuild: holes whose answers carry islands, on a csr=true
// page). Kit's start entry is cut at the network.
// Usage: pnpm exec playwright test kit-boot-failed
import { test, check } from '@ogygia/tooling/e2e';
import { console_text } from '@ogygia/tooling/e2e/browsers.ts';

test.describe("Kit's client code fails to load", () => {
	test('an island waiting for Kit fails and says kit_boot_failed', async ({ page }) => {
		const logged: Promise<string>[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') logged.push(console_text(m));
		});
		await page.route(
			(url) => url.pathname.includes('/_app/immutable/entry/start.'),
			(route) => route.abort('connectionreset')
		);
		await page.goto('/hole-kit-rebuild/', { waitUntil: 'domcontentloaded' });
		// the holes' answers land and their islands wake into the wait; give them time
		await page.waitForTimeout(4000);
		const text = (await Promise.all(logged)).join('\n');
		check("the page says Kit's client code failed to load", /kit_boot_failed/.test(text), text);
	});
});
