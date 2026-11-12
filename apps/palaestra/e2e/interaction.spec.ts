// wake:'interaction' — the island ships no JS until a pointer/key/focus lands inside it; the
// first click is canceled + replayed after hydration (counts exactly once, isTrusted=false);
// typing before hydration survives (value restored, bind synced); hover warms the chunk without
// hydrating; hydratedBy() reports 'interaction'.
// Usage: pnpm exec playwright test interaction
import { test, check, expect } from '@ogygia/tooling/e2e';
import { console_text } from '@ogygia/tooling/e2e/browsers.ts';

const WAKE_INTERACTION_RE = /ogygia-region[^>]*wake="interaction"/;
const INTERACTION_ENTRY_RE = /ogygia-region entry="([^"]+)"[^>]*wake="interaction"/;
// the file the island actually loads: its content-hashed location (`src`, last on the tag)
const INTERACTION_SRC_RE = /ogygia-region entry="[^"]+"[^>]*wake="interaction"[^>]*\ssrc="([^"]+)"/;
const SHUT_RE = /shut/;
const COUNT_IS_1_RE = /count is 1/;

test.describe("wake:'interaction' — cold until used, click replay, typing survives", () => {
	// The SSR probe feeds every browser section (the entry chunk's file name), so it runs once up
	// front; `baseURL` is test-scoped, so the hook reads it off the project options.
	let raw = '';
	let interaction_entry = '';
	/** the island's file: its location in a build, its identity where it has none (dev) */
	let interaction_file = '';
	// Playwright reads the destructured first argument to decide which fixtures to inject; this
	// hook needs none (only testInfo), so the empty pattern must stay.
	// oxlint-disable-next-line no-empty-pattern
	test.beforeAll(async ({}, testInfo) => {
		raw = await (await fetch(`${testInfo.project.use.baseURL}/interaction`)).text();
		interaction_entry = raw.match(INTERACTION_ENTRY_RE)?.[1] ?? '';
		interaction_file = raw.match(INTERACTION_SRC_RE)?.[1] ?? interaction_entry;
	});

	// ---------- SSR ----------
	test('SSR: the region carries wake="interaction" + an entry chunk', async () => {
		check('SSR: region carries wake="interaction"', WAKE_INTERACTION_RE.test(raw));
		check(
			'SSR: interaction region has an entry chunk',
			interaction_entry.length > 0,
			interaction_entry
		);
	});

	// ---------- cold: bytes ride background hints, but NOTHING executes ----------
	test('cold → hover → first click replays exactly once → second click live', async ({ page }) => {
		const fetched: string[] = [];
		page.on('request', (r) => fetched.push(r.url()));
		await page.goto('/interaction', { waitUntil: 'networkidle' });
		await page.waitForTimeout(300);
		const entryFile = interaction_file.split('/').pop() ?? '@@none@@';
		// An interaction island's bytes do not move before intent: no modulepreload for its chunk, no
		// background fetch — the hover / focus / touch warm-up below fetches it (with its whole graph,
		// island-graph-preload.ts), and the first click is still replayed.
		const hint = await page.locator(`link[rel="modulepreload"][href*="${entryFile}"]`).count();
		check('cold: no modulepreload for the interaction chunk', hint === 0);
		check(
			'cold: chunk NOT fetched before intent',
			!fetched.some((u) => u.includes(entryFile)),
			entryFile
		);
		check(
			'cold: region not hydrated',
			(await page.locator('ogygia-region[wake="interaction"][data-hydrated]').count()) === 0
		);
		// eager load island on the same page DID hydrate (islands generally work here)
		check(
			'cold: eager island on same page hydrated',
			(await page.locator('ogygia-region[wake="load"][data-hydrated]').count()) === 1
		);

		// ---------- hover pre-evaluates (cache hit) without hydrating ----------
		await page.locator('[data-interaction-counter]').hover();
		await page.waitForTimeout(250);
		check(
			'hover: still not hydrated',
			(await page.locator('ogygia-region[wake="interaction"][data-hydrated]').count()) === 0
		);

		// ---------- first click wakes + replays (counts exactly once) ----------
		// Whether the island was still waking when the browser's own click fired: its press wakes it,
		// and a warmed island can be live before the click lands (Firefox and WebKit space a click's
		// events out more than Chromium does). Waking: the click is replayed, untrusted. Live: it
		// lands natively, trusted. Either way it counts once.
		await page.evaluate(() => {
			const w = window as Window & { __click_while_waking?: boolean };
			window.addEventListener(
				'click',
				(e) => {
					if (!e.isTrusted || w.__click_while_waking !== undefined) return;
					w.__click_while_waking =
						document.querySelector('ogygia-region[wake="interaction"][data-hydrated]') === null;
				},
				{ capture: true }
			);
		});
		await page.locator('[data-i-btn]').click();
		await page.waitForTimeout(300);
		check(
			'click: island hydrated',
			(await page.locator('ogygia-region[wake="interaction"][data-hydrated]').count()) === 1
		);
		check(
			'click: FIRST click counted (replay, exactly once)',
			(await page.locator('[data-i-count]').innerText()) === '1',
			`count=${await page.locator('[data-i-count]').innerText()}`
		);
		const while_waking = await page.evaluate(
			() => (window as Window & { __click_while_waking?: boolean }).__click_while_waking
		);
		const trusted = await page.locator('[data-i-trusted]').innerText();
		check(
			'click: replayed while waking is untrusted, landed live is trusted (documented semantics)',
			typeof while_waking === 'boolean' && trusted === (while_waking ? 'false' : 'true'),
			`while waking: ${while_waking}, trusted: ${trusted}`
		);
		check(
			'click: hydratedBy() === interaction',
			(await page.locator('[data-interaction-counter]').getAttribute('data-woke')) === 'interaction'
		);

		// second click is live + trusted
		await page.locator('[data-i-btn]').click();
		await page.waitForTimeout(50);
		check(
			'second click: live island counts (2)',
			(await page.locator('[data-i-count]').innerText()) === '2'
		);
		check(
			'second click: trusted (real handler now)',
			(await page.locator('[data-i-trusted]').innerText()) === 'true'
		);
	});

	// ---------- interaction × crossed children (composed island on the interaction schedule) ----------
	test('interaction × crossed children: the composed island wakes on the toggle, replays once', async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/interaction', { waitUntil: 'networkidle' });
		await page.waitForTimeout(200);

		const card = page.locator('[data-ix-card]');
		check(
			'children: crossed child SSR-rendered, island cold',
			(await card.locator('[data-ix-child]').innerText()) ===
				'crossed child inside an interaction island'
		);
		check(
			'children: card region not hydrated before use',
			(await card.locator('ogygia-region[data-hydrated]').count()) === 0
		);

		// First click on the toggle: wakes the synthesized-children entry, replays EXACTLY once —
		// initial open=true, so exactly one activation flips it shut and hides the crossed child.
		await card.locator('[data-card-toggle]').click();
		await page.waitForTimeout(300);
		check(
			'children: click hydrated the composed island',
			(await card.locator('ogygia-region[data-hydrated]').count()) === 1
		);
		check(
			'children: waking toggle applied exactly once (open → shut)',
			SHUT_RE.test((await card.locator('[data-card-toggle]').innerText()) || ''),
			await card.locator('[data-card-toggle]').innerText()
		);
		check(
			'children: crossed child hidden by the replayed toggle',
			(await card.locator('[data-ix-child]').count()) === 0
		);

		// Live now: second click restores the crossed child.
		await card.locator('[data-card-toggle]').click();
		await page.waitForTimeout(50);
		check(
			'children: live toggle restores crossed child',
			(await card.locator('[data-ix-child]').count()) === 1
		);
		check('children: no page errors', errors.length === 0, errors.join(' | '));
	});

	// ---------- hydration FAILURE disarms (clicks stop being eaten, error logged) ----------
	test('hydration failure disarms: no crash, error logged, rest of the page still works', async ({
		page
	}) => {
		const consoleErrs: string[] = [];
		// (each read awaits the page: the check below waits for the reads still out)
		const reads: Promise<void>[] = [];
		page.on('console', (m) => {
			// (the message's own text in every engine: Firefox's console text of an Error is its class)
			if (m.type() === 'error') reads.push(console_text(m).then((t) => void consoleErrs.push(t)));
		});
		// Block the island's file (under any retry mark: a dropped download is asked for again under a
		// fresh URL) AND its stable name (the fallback a lost location takes) → the wake's import
		// truly fails.
		const entryFile = interaction_file.split('/').pop() ?? '@@none@@';
		const stableFile = interaction_entry.split('/').pop() ?? '@@none@@';
		await page.route(
			(url) => url.pathname.endsWith(`/${entryFile}`),
			(r) => r.abort()
		);
		await page.route(
			(url) => url.pathname.endsWith(`/${stableFile}`),
			(r) => r.abort()
		);
		await page.goto('/interaction', { waitUntil: 'networkidle' });
		await page.locator('[data-i-btn]').click();
		await page.waitForTimeout(400);
		check(
			'failure: island stays unhydrated (no crash)',
			(await page.locator('ogygia-region[wake="interaction"][data-hydrated]').count()) === 0
		);
		// The chunk was aborted, so this is an ENTRY-FETCH failure, not a hydrate throw — the runtime
		// distinguishes them (dev names the Vite re-optimize cause; here it's a real abort). #hydrate
		// catches it, logs, and the wake path disarms on the fulfilled branch. The report comes after
		// the retries give up, and WebKit's come later than a fixed pause (a dropped download gets no
		// timing entry there, so each one waits out its entry: runtime/import-again.ts).
		const reported = () =>
			// (a production build: the message is its code's link — messages/core.ts)
			consoleErrs.some(
				(t) =>
					t.includes('e/island_load_failed') ||
					t.includes('e/island_hydrate_failed') ||
					t.includes('e/interaction_hydrate_failed')
			);
		await expect
			.poll(async () => (await Promise.all(reads), reported()), {
				message: 'failure: error logged, region left static'
			})
			.toBe(true);
		// The page survives — the eager island is still live.
		await page.locator('[data-counter] button').click();
		check(
			'failure: rest of the page still works',
			COUNT_IS_1_RE.test((await page.locator('[data-counter]').textContent()) || '')
		);
	});

	// ---------- typing wakes it and the text survives hydration ----------
	test('typing wakes it and the text survives hydration', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/interaction', { waitUntil: 'networkidle' });
		// type immediately — keydown wakes it; characters land natively while it hydrates
		await page.locator('[data-i-input]').pressSequentially('hello', { delay: 15 });
		await page.waitForTimeout(400);
		check(
			'typing: island hydrated by keystrokes',
			(await page.locator('ogygia-region[wake="interaction"][data-hydrated]').count()) === 1
		);
		check(
			'typing: input value survived hydration',
			(await page.locator('[data-i-input]').inputValue()) === 'hello',
			`value=${await page.locator('[data-i-input]').inputValue()}`
		);
		check(
			'typing: bind:value synced after restore',
			(await page.locator('[data-i-typed]').innerText()) === 'hello',
			`bound=${await page.locator('[data-i-typed]').innerText()}`
		);
		check(
			'typing: focus stayed in the input',
			await page.locator('[data-i-input]').evaluate((el) => el === document.activeElement)
		);
		check('typing: no page errors', errors.length === 0, errors.join(' | '));
	});
});
