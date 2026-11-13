// Record a Chromium trace of one page load the way a lab tool does (CPU throttled), with JS
// sampling, and count what the page and the runtime did. Read it with ./tbt-blame.ts.
//
//   node internal/checks/tbt-record.ts <url> <out-prefix> [cpu-rate=6] [wait-ms=10000]
//
// Writes <out-prefix>.trace.json and <out-prefix>.facts.json.
import fs from 'node:fs';
import { chromium } from 'playwright';

const [url, out, rate_s, wait_s] = process.argv.slice(2);
if (!url || !out) {
	console.error(
		'usage: node internal/checks/tbt-record.ts <url> <out-prefix> [cpu-rate] [wait-ms]'
	);
	process.exit(1);
}
const RATE = Number(rate_s ?? 6);
const WAIT = Number(wait_s ?? 10_000);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1350, height: 940 } });
const page = await ctx.newPage();
const scripts: string[] = [];
page.on('request', (q) => {
	if (q.resourceType() === 'script') scripts.push(q.url());
});
let errors = 0;
page.on('console', (m) => {
	if (m.type() === 'error') errors++;
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
await browser.startTracing(page, {
	path: `${out}.trace.json`,
	categories: [
		'devtools.timeline',
		'disabled-by-default-devtools.timeline',
		'disabled-by-default-devtools.timeline.stack',
		'disabled-by-default-v8.cpu_profiler',
		'v8.execute',
		'v8',
		'blink.user_timing',
		'loading',
		'toplevel'
	]
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(WAIT);
await browser.stopTracing();
const { result } = await cdp.send('Profiler.takePreciseCoverage');
const page_facts = await page.evaluate(() => ({
	xw: (window as unknown as { __xw?: unknown }).__xw,
	regions: document.querySelectorAll('ogygia-region').length,
	hydrated: document.querySelectorAll('ogygia-region[data-hydrated]').length,
	elements: document.querySelectorAll('*').length
}));
const counts: Record<string, Record<string, number>> = {};
for (const s of result) {
	if (!s.url.startsWith('http')) continue;
	const file = new URL(s.url).pathname.split('/').pop()!;
	const per_file = (counts[file] ??= {});
	for (const f of s.functions) {
		const n = f.ranges[0]?.count ?? 0;
		if (!n || !f.functionName) continue;
		per_file[f.functionName] = (per_file[f.functionName] ?? 0) + n;
	}
}
fs.writeFileSync(
	`${out}.facts.json`,
	JSON.stringify({ url, rate: RATE, scripts, errors, page_facts, counts }, null, 1)
);
console.log(JSON.stringify({ errors, page_facts, scripts: scripts.length }));
await browser.close();
