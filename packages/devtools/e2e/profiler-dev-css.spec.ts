// THE PROFILER'S SHEET STAYS ON PROFILER PAGES IN DEV. The profiler UI's shared stylesheet is global
// (a dark ground, `body` rules). In dev, Kit inlines every stylesheet it finds in a page's SSR graph;
// once an app page's graph reaches the profiler's Shell, the sheet must still not land on that page.
// /dt-profiler-css plants the edge (it imports Shell), so the guard is tested, not the luck of no edge.
//
//   pnpm --filter @ogygia/devtools e2e profiler-dev-css
import { fileURLToPath } from 'node:url';
import { test, check, REPO as repo } from '@ogygia/tooling/e2e';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const lab = fileURLToPath(new URL('./app', import.meta.url));
const PORT = port(3107);
const base = `http://127.0.0.1:${PORT}`;
// a token only profiler.css declares
const SHEET = '--bg-sunken: #060907';
let srv: SpawnedServer | null = null;

test.beforeAll(async () => {
	test.setTimeout(150_000);
	srv = await spawn_server({
		cmd: 'pnpm',
		args: ['--dir', lab, 'dev', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
		cwd: repo,
		env: { ORIGIN: base },
		url: `${base}/dt-profiler-css`,
		timeout_ms: 120_000
	});
});
test.afterAll(() => srv?.kill());

test('an app page whose graph reaches the profiler shell carries none of its global sheet', async ({
	request
}) => {
	// the profiler page first: its handle loads the whole UI into the dev server's module graph
	const profiler = await (await request.get(`${base}/__profiler`)).text();
	check(
		'the profiler page carries its sheet (the token is the right one)',
		profiler.includes(SHEET)
	);
	const html = await (await request.get(`${base}/dt-profiler-css`)).text();
	check('the app page answered', html.includes('data-app-page'), html.slice(0, 200));
	check("the app page carries none of the profiler's sheet", !html.includes(SHEET));
});
