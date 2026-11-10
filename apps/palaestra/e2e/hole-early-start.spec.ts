// A HOLE THAT LOADS AT ONCE IS ASKED FOR ONCE, IN EVERY ENGINE (#404). Its request still starts
// during the HTML parse, before the runtime is even in, and the runtime takes that request over:
// one GET per hole, no batch, no second ask. (A fetch preload did the early start before, and
// WebKit never hands one to a later fetch(): every hole was asked, and rendered, twice there.)
//
//   pnpm exec playwright test hole-early-start
import { test, check } from '@ogygia/tooling/e2e';
import { ENDPOINT_PATH_RE } from '@ogygia/tooling/e2e/re.ts';

const RUNTIME_RE = /\/og-runtime[^/]*\.js(?:\?|$)/;

test('three load holes: one GET each, started before the runtime is in', async ({ page }) => {
	const asked: { url: string; method: string; at: number }[] = [];
	page.on('request', (r) => {
		if (ENDPOINT_PATH_RE.test(new URL(r.url()).pathname))
			asked.push({ url: r.url(), method: r.method(), at: Date.now() });
	});
	// the runtime is held back: whatever asks for a hole before it lands is the page's early start
	let runtime_in = Infinity;
	await page.route(RUNTIME_RE, async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		runtime_in = Date.now();
		await route.continue();
	});
	await page.goto('/frame-batch', { waitUntil: 'load' });
	await page.waitForFunction(
		() =>
			document.querySelectorAll('ogygia-region[render="defer"] [data-server-greeting]').length ===
			3,
		null,
		{ timeout: 15_000 }
	);
	await page.waitForTimeout(500);
	const gets = asked.filter((a) => a.method === 'GET');
	check('one GET per hole (three holes)', gets.length === 3, String(gets.length));
	check(
		'one GET per endpoint',
		new Set(gets.map((g) => g.url)).size === gets.length,
		gets.map((g) => g.url).join('\n')
	);
	check(
		'no batch POST',
		asked.every((a) => a.method === 'GET')
	);
	check(
		'every GET started before the runtime landed (the early start)',
		gets.every((g) => g.at < runtime_in),
		JSON.stringify({ runtime_in, at: gets.map((g) => g.at) })
	);
});
