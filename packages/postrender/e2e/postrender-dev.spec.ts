// POSTRENDER, the DEV leg: `vite dev` must NEVER serve or fill the store — an edited page has to
// re-render every time (HMR truth beats byte reuse). The purity verdict still runs and teaches:
// eligible pages carry `x-ogygia-postrender: would-store`, refusals a named console note.
// Self-contained: boots the postrender fixture app's (e2e/app) DEV server, fetches, tears down.
// Usage: pnpm --filter @ogygia/postrender e2e postrender-dev
import { fileURLToPath } from 'node:url';
import { test, check } from '@ogygia/tooling/e2e';
import { spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const dir = fileURLToPath(new URL('./app', import.meta.url));
const PORT = 3077;
const base = `http://127.0.0.1:${PORT}`;

const renders = async (): Promise<Record<string, number>> =>
	(await (await fetch(base + '/api/state')).json()).renders ?? {};
const via = (res: Response) => res.headers.get('x-ogygia-postrender');

let srv: SpawnedServer | undefined;

test.describe('POSTRENDER dev leg: vite dev never serves/fills the store (edits stay live) — would-store teaching header, per-request renders (self-booting fixture dev server)', () => {
	// spawn_server = its own process GROUP, so teardown kills the real vite child too (the pnpm-wrapper
	// orphan squats the port otherwise); `--host 127.0.0.1` pins the bind family (vite's `localhost`
	// can come up IPv6-only while this harness polls IPv4).
	test.beforeAll(async () => {
		srv = await spawn_server({
			cmd: 'pnpm',
			args: ['--dir', dir, 'dev', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
			cwd: dir,
			url: base + '/api/state',
			timeout_ms: 120_000,
			ready: (res) => res.ok
		});
	});
	test.afterAll(() => srv?.kill());

	test('an ELIGIBLE page renders EVERY time in dev (no store), flagged would-store', async () => {
		const r1 = await fetch(base + '/fr/fr/c/home');
		const r2 = await fetch(base + '/fr/fr/c/home');
		check(
			'dev: eligible page never served from the store',
			via(r2) === 'would-store',
			via(r2) ?? '(none)'
		);
		check('dev: first response taught the same', via(r1) === 'would-store');
		check(
			'dev: every request re-rendered',
			((await renders())['/fr/fr/c/home'] ?? 0) === 2,
			String((await renders())['/fr/fr/c/home'])
		);
	});

	test('a REFUSED page: no would-store, still re-renders (the named console note is dev-server-side)', async () => {
		await fetch(base + '/fr/fr/flagged');
		const f2 = await fetch(base + '/fr/fr/flagged');
		check('dev: refused page carries no would-store', via(f2) === null, via(f2) ?? '(none)');
		check('dev: refused page re-rendered too', ((await renders())['/fr/fr/flagged'] ?? 0) === 2);
	});

	test('the right handle order says nothing', () => {
		const log = srv?.logs.join('') ?? '';
		check(
			'dev: no setup warning with postrender.handle() first',
			!log.includes('postrender.handle()'),
			srv?.tail() ?? ''
		);
	});
});
