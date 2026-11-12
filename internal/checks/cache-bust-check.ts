// THE CACHE CHECK — every file the build writes under `immutable/` is named by its content, so an
// `immutable` cache can never serve last build's code after a deploy; an island's identity is a name,
// not a file, and the one file at a fixed name is the current build's location map
// (`_app/ogygia.json`). Two REAL builds of the devtools lab (adapter-node, the headers a
// deploy sends: `public,max-age=31536000,immutable`), one change between them
// (src/lib/dtcache/version.ts, a module two islands and a hole share), and a browser that KEEPS ITS
// DISK CACHE across both. Every scenario a deploy meets:
//
//   names      — only what changed gets a new name: the islands that import the changed module, and
//                only them; an untouched island and the runtime keep theirs (their cache stays good)
//   deploy     — a browser that loaded build 1 reloads under build 2: every island runs build 2, and
//                no identity is ever asked for
//   deploy-nav — build 1's document follows a link into build 2: the router loads it as a document
//                (its islands on its own build); within one build a link still swaps
//   current    — the current build's map is not served immutable, and a page that names no location
//                runs build 2 through it although the browser read build 1's copy
//   stale-kept — a cache serves build 1's HTML while build 2 is live and build 1's files are still
//                on the origin: build 1's islands run build 1 (consistent), the live hole runs build 2
//   stale-gone — the same, with build 1's files deleted: each island finds build 2's file through the
//                current map and runs it — none is left dead
//   alone      — regions with an identity alone (no `src`): each loads its file through the build's
//                content-hashed map, read once
//   refetched  — a proxy in front rewrites `_app/immutable/` to `no-cache`: a returning visitor's
//                browser revalidates every file it has, and the profiler's report names them (the
//                runtime first); the same visit straight to the server is quiet
//
//   node internal/checks/cache-bust-check.ts            (builds twice: ~3 min)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Chromium only: what it proves is the build's file names, which one engine's disk cache shows,
// and its interaction case reads the profiler's in-page sampler (the JS Self-Profiling API), which
// only Chromium has. An engine job (OGYGIA_BROWSERS without chromium) installs no Chromium.
const engines = process.env.OGYGIA_BROWSERS?.split(',')
	.map((b) => b.trim())
	.filter(Boolean);
if (engines?.length && !engines.includes('chromium')) {
	console.log(`the cache check runs in Chromium only; skipped for ${engines.join(', ')}`);
	process.exit(0);
}

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const app = path.join(repo, 'packages/devtools/e2e/app');
const version_file = path.join(app, 'src/lib/dtcache/version.ts');
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright');
const PORT = 4197;
const PROFILER_KEY = 'cache-check-profiler';
const BASE = `http://127.0.0.1:${PORT}`;

/** The profiler's own browser, logged in as a person would: the login seats a session cookie, and
 *  the next answer adds the beacon flag signed for that session (#760: neither is the raw key). */
async function profiler_login(ctx) {
	const res = await ctx.request.post(`${BASE}/__profiler/login`, { data: { key: PROFILER_KEY } });
	if (!res.ok()) throw new Error(`profiler login failed: ${res.status()}`);
	await ctx.request.get(`${BASE}/__profiler`);
}
// (inside the app: a built server resolves its dependencies through the app's node_modules)
const tmp = path.join(app, '.cache-check');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp);
const original_version = fs.readFileSync(version_file, 'utf8');

const results = [];
const check = (name, ok, extra = '') => {
	results.push(ok);
	console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

function build(version, name = version) {
	fs.writeFileSync(version_file, original_version.replace(/'v\d+'/, `'${version}'`));
	fs.rmSync(path.join(app, 'build'), { recursive: true, force: true });
	execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: app,
		env: {
			...process.env,
			LAB_ADAPTER: 'node',
			// a deploy that caches HTML: Kit's version pinned (else Kit's own chunk, and every island that
			// imports Kit code, changes every build), and one signing secret across builds (else a
			// cached page's holes are refused by the next build — cached-document-holes)
			LAB_KIT_VERSION: 'cache-check',
			OGYGIA_SECRET: 'cache-check-secret-0123456789abcdef'
		},
		stdio: 'ignore'
	});
	const out = path.join(tmp, name);
	fs.cpSync(path.join(app, 'build'), out, { recursive: true });
	const handoff = JSON.parse(
		fs.readFileSync(path.join(app, '.svelte-kit/og-region-deps.json'), 'utf8')
	);
	return { dir: out, entries: handoff.entries ?? {} };
}

/** Every server this run started and has not stopped (killed on the way out, whatever happened). */
const children = new Set();
async function serve(dir, port = PORT) {
	// a server left on the port (a run that died mid-way) would answer for this one, and every check
	// after would read another build than it names
	const busy = await fetch(`http://127.0.0.1:${port}/`).then(
		() => true,
		() => false
	);
	if (busy) throw new Error(`port ${port} already serves something: stop it first`);
	const child = spawn(process.execPath, [dir], {
		env: {
			...process.env,
			PORT: String(port),
			ORIGIN: BASE,
			OGYGIA_SECRET: 'cache-check-secret-0123456789abcdef',
			OGYGIA_PROFILER_SECRET: PROFILER_KEY
		},
		stdio: 'ignore'
	});
	children.add(child);
	child.once('exit', () => children.delete(child));
	for (let i = 0; i < 60; i++) {
		try {
			await fetch(`http://127.0.0.1:${port}/`);
			return child;
		} catch {
			await new Promise((ok) => setTimeout(ok, 250));
		}
	}
	throw new Error('server did not start');
}
const stop = async (child) => {
	child.kill();
	await new Promise((ok) => child.once('exit', ok));
};

/** Which build each probe on /dt-cache ran (`data-ran`), once every island and the hole woke. */
async function ran(page) {
	await page
		.waitForFunction(
			() =>
				['probe', 'twin', 'steady', 'hole'].every((p) =>
					document.querySelector(`[data-probe="${p}"][data-ran]`)
				),
			null,
			{ timeout: 8000 }
		)
		.catch(() => {});
	return page.evaluate(() =>
		Object.fromEntries(
			['probe', 'twin', 'steady', 'hole'].map((p) => [
				p,
				document.querySelector(`[data-probe="${p}"]`)?.getAttribute('data-ran') ?? null
			])
		)
	);
}

/** A page whose document is `html` (a cache's copy) while everything else comes from the server. */
async function page_with_document(context, html) {
	const page = await context.newPage();
	await page.route(BASE + '/dt-cache', (route) =>
		route.fulfill({ status: 200, contentType: 'text/html', body: html })
	);
	return page;
}

const identity = (name) => Object.keys(name).sort();

/** A page as it was before content hashing: no region `src`, the runtime by its stable name. */
/** A page that names no island location and no location map of its own (its runtime stays). */
function strip_locations(html) {
	return html
		.replace(/(<ogygia-region[^>]*?) src="[^"]*"/g, '$1')
		.replace(/ data-og-locations="[^"]*"/g, '');
}
try {
	console.log('building three times…');
	const one = build('v1');
	const two = build('v2');
	// NO MAP IS SERVED: the profiler's build makes the browser's maps (hidden) and moves them into the
	// server's profiler module — none may be left in the client output, nor in the stash they passed by
	{
		const maps = [];
		const walk = (d) => {
			for (const e of fs.readdirSync(d, { withFileTypes: true })) {
				const p = path.join(d, e.name);
				if (e.isDirectory()) walk(p);
				else if (e.name.endsWith('.map')) maps.push(path.relative(two.dir, p));
			}
		};
		walk(path.join(two.dir, 'client'));
		check(
			'no source map in the served client output',
			maps.length === 0,
			maps.slice(0, 3).join(', ')
		);
		check(
			'…and the stash they passed through is gone',
			!fs.existsSync(path.join(app, '.svelte-kit', 'ogygia-client-maps'))
		);
		const js = fs.readFileSync(
			path.join(
				two.dir,
				'client',
				two.entries[Object.keys(two.entries).find((k) => k.includes('og-runtime'))].replace(
					/^\//,
					''
				)
			),
			'utf8'
		);
		check('…and no chunk points at one', !js.includes('sourceMappingURL'));
	}
	// the same source again: nothing may move (a name that changes with no change costs every cache)
	const again = build('v2', 'v2-again');
	fs.writeFileSync(version_file, original_version);

	// ── names: only what changed moved ───────────────────────────────────────────────────────────
	const ids = identity(one.entries);
	check(
		'both builds name the same entries (identities are stable)',
		JSON.stringify(ids) === JSON.stringify(identity(two.entries)),
		`${ids.length}`
	);
	const moved = ids.filter((k) => one.entries[k] !== two.entries[k]);
	const html1 = await (async () => {
		const s = await serve(one.dir);
		try {
			return await (await fetch(BASE + '/dt-cache')).text();
		} finally {
			await stop(s);
		}
	})();
	// the page's islands in order: Probe, ProbeTwin, Steady (identities as the handoff keys them)
	const island_ids = [...html1.matchAll(/<ogygia-region entry="([^"]+)"/g)].map((m) =>
		m[1].replace(/^\.\//, '/')
	);
	const [probe_id, twin_id, steady_id] = island_ids;
	const runtime_id = ids.find((k) => k.includes('og-runtime'));
	check(
		'the islands on the changed module moved (Probe, ProbeTwin)',
		moved.includes(probe_id) && moved.includes(twin_id),
		`${moved.length} moved in all (every importer of the chunk that holds it)`
	);
	check(
		'the untouched island kept its name (its cache stays good)',
		!!steady_id && !moved.includes(steady_id)
	);
	check(
		'the runtime kept its name',
		!!runtime_id && one.entries[runtime_id] === two.entries[runtime_id],
		runtime_id ? two.entries[runtime_id] : 'no runtime'
	);
	const drift = ids.filter((k) => two.entries[k] !== again.entries[k]);
	check(
		'the same source built again moves no name',
		drift.length === 0,
		drift.slice(0, 3).join(', ')
	);
	// a location: its stable name plus a content hash (`og-region.<iid>.<hash>.js`) under `immutable/`,
	// never the name itself; the stable name lives outside `immutable/`, where a host revalidates it
	const readable = ([identity, location]) => {
		const id_file = identity.split('/').pop();
		const loc_file = location.split('/').pop();
		return (
			location.includes('/immutable/') &&
			!identity.includes('/immutable/') &&
			/\.[\w-]{8}\.js$/.test(location) &&
			// an island keeps its whole stable name as the prefix; the runtime its `og-runtime.` part
			(id_file.startsWith('og-runtime.')
				? /^og-runtime[.-]/.test(loc_file)
				: loc_file.startsWith(id_file.slice(0, -'.js'.length) + '.'))
		);
	};
	check(
		'every location is its stable name plus a content hash, under immutable/; no stable name is',
		Object.entries(two.entries).every(readable),
		`${ids.find((k) => k.includes('og-region'))} → ${two.entries[ids.find((k) => k.includes('og-region'))]}`
	);
	// THE IMMUTABLE LAW, over the two real builds: no file under `immutable/` keeps its name while its
	// content changes (a host serves it for a year by that name). Every file, ogygia's or not.
	{
		const files = (root) => {
			const out = new Map();
			const walk = (d) => {
				for (const e of fs.readdirSync(d, { withFileTypes: true })) {
					const p = path.join(d, e.name);
					if (e.isDirectory()) walk(p);
					else out.set(path.relative(root, p), p);
				}
			};
			walk(root);
			return out;
		};
		const a = files(path.join(one.dir, 'client/_app/immutable'));
		const b = files(path.join(two.dir, 'client/_app/immutable'));
		const broken = [...b.keys()].filter(
			(f) => a.has(f) && !fs.readFileSync(a.get(f)).equals(fs.readFileSync(b.get(f)))
		);
		check(
			'immutable/: no file keeps its name with new content (across the two builds)',
			broken.length === 0 && b.size > 0,
			broken.length ? broken.slice(0, 4).join(', ') : `${b.size} files, ${a.size} before`
		);
	}
	// an identity is a name, never a file: the one file at a fixed name is the current build's map,
	// beside Kit's own `version.json`; ogygia writes no directory of its own
	{
		const client = path.join(two.dir, 'client/_app');
		const top = fs.readdirSync(client, { withFileTypes: true });
		const dirs = top.filter((e) => e.isDirectory()).map((e) => e.name);
		const loose = top.filter((e) => e.isFile()).map((e) => e.name);
		check(
			'outside immutable/: only Kit’s version.json and the current build’s map; no ogygia directory',
			!dirs.includes('ogygia') &&
				loose.includes('ogygia.json') &&
				loose.every((f) => /^(version|ogygia)\.json(\.br|\.gz)?$/.test(f)),
			`dirs: ${dirs.join(', ')} · files: ${loose.join(', ')}`
		);
		const current = JSON.parse(fs.readFileSync(path.join(client, 'ogygia.json'), 'utf8'));
		const island = ids.find((k) => k.includes('og-region'));
		const key = './ogygia/' + island.split('/').pop();
		check(
			'the current build’s map names each island’s file',
			new URL(current[key], 'http://x/_app/ogygia.json').pathname === two.entries[island],
			`${island} → ${current[key]}`
		);
	}

	const browser_dir = path.join(tmp, 'profile');
	const context = await chromium.launchPersistentContext(browser_dir, {
		viewport: { width: 1280, height: 900 }
	});
	const errors = [];
	context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));

	// ── deploy: build 1, then build 2 with the disk cache kept ──────────────────────────────────
	let server = await serve(one.dir);
	const page = await context.newPage();
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto(BASE + '/dt-cache', { waitUntil: 'load' });
	const before = await ran(page);
	check(
		'build 1 runs build 1',
		before.probe === 'v1' &&
			before.twin === 'v1' &&
			before.hole === 'v1' &&
			before.steady === 'steady',
		JSON.stringify(before)
	);
	await stop(server);

	server = await serve(two.dir);
	// DEPLOY-NAV: build 1's document, still open, follows a link once build 2 is live. The next page
	// names another runtime and location map: the router loads it as a document (its islands on its
	// own build) instead of swapping it into build 1's runtime.
	{
		await page.evaluate(() => {
			(window as unknown as { __og_doc: number }).__og_doc = 1;
			const a = document.createElement('a');
			a.href = '/dt-cache?after-deploy';
			a.id = 'og-deploy-nav';
			a.textContent = 'next';
			document.body.append(a);
		});
		// (the router updates the address before it fetches: a matched URL can still be build 1's
		// document, so wait for the new document itself — or give up, and the check says swapped)
		const new_document = page
			.waitForEvent('domcontentloaded', { timeout: 15_000 })
			.then(() => page.waitForLoadState('load'))
			.catch(() => {});
		await page.click('#og-deploy-nav');
		await new_document;
		await page.waitForURL('**/dt-cache?after-deploy');
		const nav = await ran(page);
		const loaded = await page.evaluate(
			() => (window as unknown as { __og_doc?: number }).__og_doc === undefined
		);
		check(
			'deploy-nav: a link from a build-1 page into build 2 loads the document, on build 2',
			loaded && nav.probe === 'v2' && nav.twin === 'v2' && nav.steady === 'steady',
			`${loaded ? 'loaded' : 'swapped'} · ${JSON.stringify(nav)}`
		);
		// …and within one build, a link still swaps (the check is not a reload on every link)
		await page.evaluate(() => {
			(window as unknown as { __og_doc: number }).__og_doc = 2;
			const a = document.createElement('a');
			a.href = '/dt-cache?same-build';
			a.id = 'og-same-nav';
			a.textContent = 'again';
			document.body.append(a);
			// the router's own "navigation done" (a document load would replace this listener)
			const w = window as unknown as { __og_nav?: Promise<void> };
			w.__og_nav = new Promise((done) =>
				document.addEventListener('og:page-load', () => done(), { once: true })
			);
		});
		await page.click('#og-same-nav');
		await page.waitForURL('**/dt-cache?same-build');
		await page
			.waitForFunction(() => (window as unknown as { __og_nav?: Promise<void> }).__og_nav, null, {
				timeout: 15_000
			})
			.catch(() => {});
		await page.evaluate(() => (window as unknown as { __og_nav?: Promise<void> }).__og_nav);
		await ran(page);
		const kept = await page.evaluate(
			() => (window as unknown as { __og_doc?: number }).__og_doc === 2
		);
		check('deploy-nav: within one build, a link swaps the page', kept, kept ? 'swapped' : 'loaded');
		await page.goto(BASE + '/dt-cache', { waitUntil: 'load' });
	}
	const stable_hits = [];
	page.on(
		'request',
		(r) => /og-region\.[0-9a-f]{12}\.js/.test(r.url()) && stable_hits.push(r.url())
	);
	await page.reload({ waitUntil: 'load' });
	const after = await ran(page);
	check(
		'deploy: after a normal reload every island runs build 2',
		after.probe === 'v2' && after.twin === 'v2' && after.hole === 'v2' && after.steady === 'steady',
		JSON.stringify(after)
	);
	check(
		'deploy: no identity is ever asked for (an identity is a name, not a file)',
		stable_hits.length === 0,
		`${stable_hits.length} requests`
	);
	// THE CURRENT BUILD'S MAP, the one file at a fixed name: outside `immutable/`, so the host serves it
	// as any changing file. The same browser — which read build 1's copy of it — on a page that names
	// no location and no map of its own: every island loads build 2's file through it.
	// (the page is a static file the server serves, never a routed response: Playwright turns the
	// HTTP cache off for a page with a route, and this check is about that cache)
	{
		const map_head = await fetch(BASE + '/_app/ogygia.json', { method: 'HEAD' });
		check(
			'current map: the host does not serve it immutable',
			map_head.ok && !/immutable/.test(map_head.headers.get('cache-control') ?? ''),
			`${map_head.status} ${map_head.headers.get('cache-control') ?? '(no cache-control)'}`
		);
		const html2_live = await (await fetch(BASE + '/dt-cache')).text();
		await stop(server);
		fs.writeFileSync(path.join(two.dir, 'client/og-control.html'), strip_locations(html2_live));
		server = await serve(two.dir);
		const control = await context.newPage();
		await control.goto(BASE + '/og-control.html', { waitUntil: 'load' });
		const c = await ran(control);
		check(
			'current map: a page that names no location runs build 2 through it',
			c.probe === 'v2' && c.twin === 'v2',
			JSON.stringify(c)
		);
		await control.close();
		fs.rmSync(path.join(two.dir, 'client/og-control.html'));
	}

	// ── stale HTML, build 1's files still on the origin ─────────────────────────────────────────
	await stop(server);
	const merged = path.join(tmp, 'merged');
	fs.cpSync(two.dir, merged, { recursive: true });
	fs.cpSync(
		path.join(one.dir, 'client/_app/immutable'),
		path.join(merged, 'client/_app/immutable'),
		{ recursive: true, force: false, errorOnExist: false }
	);
	server = await serve(merged);
	const kept = await page_with_document(context, html1);
	await kept.goto(BASE + '/dt-cache', { waitUntil: 'load' });
	const k = await ran(kept);
	check(
		'stale-kept: a cached build-1 page runs build 1 throughout (the live hole answers from build 2)',
		k.probe === 'v1' && k.twin === 'v1' && k.steady === 'steady' && k.hole === 'v2',
		JSON.stringify(k)
	);
	await kept.close();
	await stop(server);

	// ── stale HTML, build 1's files gone ────────────────────────────────────────────────────────
	server = await serve(two.dir);
	const gone_ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile-gone'), {
		viewport: { width: 1280, height: 900 }
	});
	const gone_errors = [];
	const gone = await page_with_document(gone_ctx, html1);
	gone.on('pageerror', (e) => gone_errors.push(e.message));
	await gone.goto(BASE + '/dt-cache', { waitUntil: 'load' });
	const g = await ran(gone);
	check(
		'stale-gone: each island finds build 2’s file through the current map, and runs it (none left dead)',
		g.probe === 'v2' && g.twin === 'v2' && g.steady === 'steady' && g.hole === 'v2',
		JSON.stringify(g)
	);
	check(
		'stale-gone: no uncaught error on the page',
		gone_errors.length === 0,
		gone_errors.slice(0, 2).join(' | ')
	);
	await gone_ctx.close();

	// ── the profiler: two profiles of one build keep every island's file ────────────────────────
	// ("since your last profile": island files changed / kept — what a deploy costs a returning
	// visitor; within one build, nothing may read as changed)
	{
		const profile = async () =>
			(
				await fetch(`${BASE}/__profiler/page?p=/dt-cache&runs=1&format=json`, {
					headers: { 'x-profiler-key': PROFILER_KEY }
				})
			)
				.json()
				.catch(() => null);
		await profile();
		const second = await profile();
		const isl = second?.since?.islands;
		check(
			'profiler: a second profile of one build keeps every island file (none changed)',
			!!isl && isl.moved.length === 0 && isl.kept >= 3 && !isl.all_moved,
			JSON.stringify(isl ?? second?.since ?? second?.error ?? null).slice(0, 200)
		);
	}

	// ── refetched: a host that does not let the browser keep the content-named files ────────────
	// The server moves behind a proxy on BASE that passes everything through and rewrites the
	// `cache-control` of `_app/immutable/` to `no-cache` (a CDN rule or a custom server in front, as
	// met in the field). A browser loads the page once (its cache fills), the profiler records it,
	// and the browser comes back: every content-named file is revalidated (a 304 each), and the
	// report's own visit (the first after the recording) must name them. The same, through a proxy
	// that changes nothing, must be quiet: its files come from the cache.
	{
		await stop(server);
		const INNER = PORT + 2;
		server = await serve(two.dir, INNER);
		const through = (rewrite) =>
			http.createServer((req, res) => {
				const up = http.request(
					{
						host: '127.0.0.1',
						port: INNER,
						path: req.url,
						method: req.method,
						headers: req.headers
					},
					(r) => {
						const headers = { ...r.headers };
						if (rewrite && req.url.startsWith('/_app/immutable/')) {
							headers['cache-control'] = rewrite;
							// (`no-store`: a host that also drops the validators — nothing to revalidate with)
							if (rewrite === 'no-store') {
								delete headers.etag;
								delete headers['last-modified'];
							}
						}
						res.writeHead(r.statusCode ?? 502, headers);
						r.pipe(res);
					}
				);
				up.on('error', () => res.writeHead(502).end());
				req.pipe(up);
			});
		const visit = async (rewrite, dir) => {
			const proxy = through(rewrite);
			await new Promise((ok) => proxy.listen(PORT, '127.0.0.1', ok));
			const ctx = await chromium.launchPersistentContext(path.join(tmp, dir), {
				viewport: { width: 1280, height: 900 }
			});
			// the profiler's own browser, logged in: the server adds its beacon to the page, and takes
			// the beacon's posts (the session; the flag follows it)
			await profiler_login(ctx);
			const p = await ctx.newPage();
			const statuses = [];
			p.on('response', (r) => r.url().includes('/_app/immutable/') && statuses.push(r.status()));
			await p.goto(BASE + '/dt-cache', { waitUntil: 'load' });
			await ran(p);
			// (past the report's second of clock slack: else the warm-up visit reads as the report's own)
			await p.waitForTimeout(1600);
			const rec = await fetch(`${BASE}/__profiler/page?p=/dt-cache&runs=1&format=json`, {
				headers: { 'x-profiler-key': PROFILER_KEY }
			})
				.then((r) => r.json())
				.catch(() => null);
			const id = rec?.id ?? rec?.report?.id ?? null;
			// (a link, the return a visitor makes; with `no-store`, a reload: the browser had every
			// file a moment ago)
			statuses.length = 0;
			if (rewrite === 'no-store') await p.reload({ waitUntil: 'load' });
			else await p.goto(BASE + '/dt-cache', { waitUntil: 'load' });
			await ran(p);
			// what the browser itself saw, each URL once — the counts the report must quote: files that
			// came back as a 304 (headers only, no body), and files that came down whole on a reload
			const seen = await p.evaluate(() => {
				const re = new Set();
				const down = new Set();
				const reload = performance.getEntriesByType('navigation')[0].type === 'reload';
				for (const r of performance.getEntriesByType('resource')) {
					if (!r.name.includes('/_app/immutable/') || !(r.transferSize > 0)) continue;
					if (r.encodedBodySize === 0) re.add(r.name);
					else if (reload && r.transferSize >= r.encodedBodySize) down.add(r.name);
				}
				return { revalidated: re.size, downloaded: down.size };
			});
			// (the beacon posts its visit on the page's hide)
			await p.goto('about:blank');
			let finding = null;
			let report = null;
			for (let i = 0; i < 10 && id && !finding; i++) {
				await new Promise((ok) => setTimeout(ok, 700));
				report = await fetch(`${BASE}/__profiler/report/${id}.json`, {
					headers: { 'x-profiler-key': PROFILER_KEY }
				})
					.then((r) => r.json())
					.catch(() => null);
				finding = report?.findings?.find((f) => f.code === 'files-fetched-again')?.message ?? null;
			}
			await ctx.close();
			await new Promise((ok) => proxy.close(ok));
			return {
				id,
				finding,
				has_visit: !!report?.browser?.visit,
				not_modified: statuses.filter((s) => s === 304).length,
				loads: statuses.length,
				seen
			};
		};
		const planted = await visit('no-cache', 'profile-refetch');
		check(
			'refetched: the return visit revalidated the content-named files (304s)',
			planted.not_modified >= 4,
			`${planted.not_modified} of ${planted.loads} immutable requests answered 304`
		);
		// every file the browser revalidated is counted, each once (a 304 is headers only, no body:
		// the shape the beacon reads), and no island is left as a file name
		check(
			'refetched: the profiler report counts every file the browser revalidated, islands by name',
			planted.seen.revalidated >= 4 &&
				!!planted.finding &&
				planted.finding.includes(
					`${planted.seen.revalidated} were revalidated with the server (`
				) &&
				!planted.finding.includes('og-region.'),
			JSON.stringify({
				seen: planted.seen,
				id: planted.id,
				finding: planted.finding?.slice(0, 260) ?? null
			})
		);
		// a host that sends `no-store` and no validators: on a reload every file comes down whole
		const stored = await visit('no-store', 'profile-refetch-store');
		check(
			'refetched: `no-store` — on a reload the report counts every file that came down again, with its bytes',
			stored.seen.downloaded >= 4 &&
				stored.seen.revalidated === 0 &&
				!!stored.finding &&
				stored.finding.includes(`${stored.seen.downloaded} came down again on this reload (`) &&
				stored.finding.includes('KB)') &&
				!stored.finding.includes('og-region.'),
			JSON.stringify({ seen: stored.seen, finding: stored.finding?.slice(0, 260) ?? null })
		);
		const clean = await visit(null, 'profile-refetch-clean');
		check(
			'refetched: served as built (immutable), the same return visit is quiet',
			!!clean.id && clean.has_visit && !clean.finding && clean.not_modified === 0,
			JSON.stringify(clean)
		);
		await stop(server);
		server = await serve(two.dir);
	}

	// ── the slowest interaction, sampled, in a build ────────────────────────────────────────────
	// The profiler's own browser (logged in: the server sets the profiling policy) samples the load,
	// then waits, sampling, for a slow interaction. A click after the load trace is out: the trace
	// reaches the report, and a frame it cannot name (a build's minified chunk) is never quoted.
	{
		const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile-inp'), {
			viewport: { width: 1280, height: 900 }
		});
		await profiler_login(ctx);
		const rec = await fetch(`${BASE}/__profiler/page?p=/dt-inp&runs=1&format=json`, {
			headers: { 'x-profiler-key': PROFILER_KEY }
		})
			.then((r) => r.json())
			.catch(() => null);
		const p = await ctx.newPage();
		await p.goto(BASE + '/dt-inp', { waitUntil: 'load' });
		// past the load trace (8 s, or longer while islands still wake): the interaction sampler runs
		await p.waitForTimeout(11_000);
		const b = await p.locator('[data-inp="save"]').boundingBox();
		await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
		await p.waitForTimeout(1500);
		await p.goto('about:blank');
		let m = null;
		for (let i = 0; i < 10 && rec?.id && !m?.includes('sampled'); i++) {
			await new Promise((ok) => setTimeout(ok, 700));
			const j = await fetch(`${BASE}/__profiler/report/${rec.id}.json`, {
				headers: { 'x-profiler-key': PROFILER_KEY }
			})
				.then((r) => r.json())
				.catch(() => null);
			m = j?.findings?.find((f) => f.code === 'slow-interaction')?.message ?? null;
		}
		await ctx.close();
		// (the build's browser maps ride in the server's profiler module, never in the served output:
		// the minified frame is named by its source function and line)
		check(
			'inp: in a build, the report names the handler’s function by its source line',
			!!m &&
				m.includes("(mostly SlowSave's save (SlowSave.svelte:5), ") &&
				m.includes('ms sampled'),
			m ?? `no finding (report ${rec?.id ?? 'none'})`
		);
	}

	const html2 = await (await fetch(BASE + '/dt-cache')).text();

	// ── regions with an identity alone (the browser rendered them, or they came over the wire) ──
	// The build's page, every region's `src` dropped and nothing else: the runtime's script still
	// names the build's location map, and each island loads its location through it — no stable name
	// is ever asked for.
	{
		const alone = html2.replace(/(<ogygia-region[^>]*?) src="[^"]*"/g, '$1');
		check(
			'identity alone: the page names the build’s location map, and no region a location',
			alone.includes('data-og-locations="') && !/<ogygia-region[^>]* src="/.test(alone)
		);
		const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile-alone'), {
			viewport: { width: 1280, height: 900 }
		});
		const errors = [];
		const p = await page_with_document(ctx, alone);
		p.on('pageerror', (e) => errors.push(e.message));
		const stable = [];
		const maps = [];
		p.on('request', (r) => {
			if (/\/ogygia\/og-(region|runtime)\./.test(r.url())) stable.push(r.url());
			if (r.url().includes('/og-locations.')) maps.push(r.url());
		});
		await p.goto(BASE + '/dt-cache', { waitUntil: 'load' });
		const a = await ran(p);
		check(
			'identity alone: every island runs build 2, loaded by its location',
			a.probe === 'v2' && a.twin === 'v2' && a.steady === 'steady' && stable.length === 0,
			`${JSON.stringify(a)} · ${stable.length} stable-name requests`
		);
		check('identity alone: the map is read once', maps.length === 1, `${maps.length} reads`);
		check('identity alone: no uncaught error', errors.length === 0, errors.slice(0, 2).join(' | '));
		await ctx.close();
	}
	await stop(server);

	check(
		'no uncaught error on the kept-cache pages',
		errors.length === 0,
		errors.slice(0, 2).join(' | ')
	);
	await context.close();
} finally {
	// (a run that throws mid-way leaves no server behind on the port for the next one)
	for (const child of children) child.kill();
	fs.writeFileSync(version_file, original_version);
	fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? '✗' : '✓'} cache check: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
