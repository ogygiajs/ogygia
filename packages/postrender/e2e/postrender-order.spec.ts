// POSTRENDER, the setup mistakes: `postrender.handle()` must run BEFORE `ogygia.handle()` in the
// `sequence()` (the stored page is served before anything renders), and leaving it out must never be
// silent. The fixture's hooks.server.ts takes `POSTRENDER_HOOKS=misordered|missing`:
//   - misordered, dev → every page request is a clear error naming the fix (500 + the server log);
//   - misordered, production → ONE warning, and pages still store and serve from the handle's store;
//   - missing, production → ONE warning naming the line to paste; the memory store serves.
// The suite builds the fixture once (playwright.config.ts); each leg boots its own server.
// Usage: pnpm --filter @ogygia/postrender e2e postrender-order
import { fileURLToPath } from 'node:url';
import { test, check } from '@ogygia/tooling/e2e';
import { spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const dir = fileURLToPath(new URL('./app', import.meta.url));
const via = (res: Response) => res.headers.get('x-ogygia-postrender') ?? '';
const count = (log: string, text: string) => log.split(text).length - 1;

const MISORDERED = 'postrender.handle() must run before ogygia.handle()';
const MISSING = 'postrender.handle() is not in src/hooks.server.ts';
const FIX = 'sequence(postrender.handle(), ogygia.handle())';

/** Boot the BUILT fixture with `hooks`, on `port`. */
function serve_build(hooks: string, port: number): Promise<SpawnedServer> {
	const origin = `http://127.0.0.1:${port}`;
	return spawn_server({
		cmd: 'node',
		args: ['build/index.js'],
		cwd: dir,
		env: { PORT: String(port), ORIGIN: origin, POSTRENDER_HOOKS: hooks },
		url: origin + '/api/state',
		ready: (res) => res.ok
	});
}

test.describe('POSTRENDER handle order: misordered = dev error / production warning; missing = warning', () => {
	test('production, postrender.handle() AFTER ogygia.handle(): one warning, pages still stored', async () => {
		const port = 3076;
		const origin = `http://127.0.0.1:${port}`;
		const srv = await serve_build('misordered', port);
		try {
			const r1 = await fetch(origin + '/fr/fr/c/order');
			const r2 = await fetch(origin + '/fr/fr/c/order');
			await fetch(origin + '/fr/fr/c/other');
			check('prod misordered: the page still answers', r1.status === 200, String(r1.status));
			check(
				'prod misordered: stored, then served from the handle’s store',
				via(r1) === 'stored' && via(r2) === 'hit',
				`${via(r1) || '(none)'} / ${via(r2) || '(none)'}`
			);
			const log = srv.logs.join('');
			check(
				'prod misordered: warned exactly ONCE, naming the fix',
				count(log, MISORDERED) === 1 && log.includes(FIX),
				srv.tail()
			);
		} finally {
			srv.kill();
		}
	});

	test('production, no postrender.handle() at all: one warning, the memory store serves', async () => {
		const port = 3078;
		const origin = `http://127.0.0.1:${port}`;
		const srv = await serve_build('missing', port);
		try {
			const r1 = await fetch(origin + '/fr/fr/c/order');
			const r2 = await fetch(origin + '/fr/fr/c/order');
			check(
				'prod missing: stored, then served from the memory default',
				via(r1) === 'stored' && via(r2) === 'hit',
				`${via(r1) || '(none)'} / ${via(r2) || '(none)'}`
			);
			const log = srv.logs.join('');
			check(
				'prod missing: warned exactly ONCE, with the sequence line to paste',
				count(log, MISSING) === 1 && log.includes(FIX),
				srv.tail()
			);
		} finally {
			srv.kill();
		}
	});

	test('dev, postrender.handle() AFTER ogygia.handle(): a page request is a clear error', async () => {
		const port = 3080;
		const base = `http://127.0.0.1:${port}`;
		const srv = await spawn_server({
			cmd: 'pnpm',
			args: ['--dir', dir, 'dev', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
			cwd: dir,
			env: { POSTRENDER_HOOKS: 'misordered' },
			url: base + '/api/state',
			timeout_ms: 120_000
		});
		try {
			const res = await fetch(base + '/fr/fr/c/order');
			check('dev misordered: the page request fails (500)', res.status === 500, String(res.status));
			const log = srv.logs.join('');
			check(
				'dev misordered: the error names the order and the fix',
				log.includes(MISORDERED) && log.includes(FIX),
				srv.tail()
			);
		} finally {
			srv.kill();
		}
	});
});
