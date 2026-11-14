// Core's virtual modules (packages/compiler/src/virtual/core.ts), loaded through the
// in-memory compile: no Vite. A build module read from the whole program prescans first, so the
// first load in a cold session says the same as one after an explicit prescan; the leg and the
// mode pick what each module says (dev's kitchen-sink boot, the server-only secret, the fn
// manifest only when a decoder can revive a fn ref).
import { describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { memory_fs } from '../../../packages/compiler/src/fs.ts';
import {
	SERVER_MAP_TOKENS,
	server_manifest_maps
} from '../../../packages/compiler/src/link/server-manifest.ts';
import { LIB, ROUTES } from '../src/app.ts';
import { session, type Leg, type Session } from '../src/session.ts';

/** An app with an island (a `visible` wake) and a server island (`render: 'deferred'`); with
 *  `wire`, a remote function too, which makes the app cross Kit's wire. */
const app = ({ wire = false } = {}): Record<string, string> => ({
	[`${LIB}/Counter.svelte`]: '<button>+</button>',
	[`${LIB}/Late.svelte`]: '<p>late</p>',
	[`${ROUTES}/+page.svelte`]: dedent`
		<script>
			import Counter from '$lib/Counter.svelte' with { wake: 'visible' };
			import Late from '$lib/Late.svelte' with { render: 'deferred' };
		</script>
		<Counter />
		<Late />
	`,
	[`${ROUTES}/+page.ts`]: 'export const csr = false;\n',
	...(wire ? { [`${LIB}/data.remote.ts`]: 'export const n = 1;\n' } : {})
});

const HOST = `${ROUTES}/+page.svelte`;

async function load(s: Session, spec: string, leg: Leg): Promise<string | null> {
	const ssr = leg === 'ssr';
	const r = await s.compiler.resolve_id(spec, HOST, { ssr, resolve: async () => null });
	const id = r === null ? null : typeof r === 'string' ? r : r.id;
	if (!id) throw new Error(`${spec} did not resolve`);
	const out = await s.compiler.emit(id, { ssr, universalHooks: null });
	return out === null ? null : typeof out === 'string' ? out : out.code;
}

const cold = (files: Record<string, string>, dev = false) => session(memory_fs(files), { dev });
const warm = (files: Record<string, string>, dev = false) => {
	const s = cold(files, dev);
	s.compiler.prescan();
	return s;
};

describe('a build virtual read from the whole program prescans first', () => {
	it.each([
		['ogygia:boot/runtime-entry', 'client'],
		['ogygia:boot/runtime-flags', 'client'],
		['ogygia:boot/hydrate-features', 'client'],
		['ogygia:boot/devtools-meta', 'client'],
		['ogygia:region/transportables', 'ssr'],
		['ogygia:region/transportables', 'client'],
		['ogygia:region/transportables-eager', 'ssr'],
		['ogygia:server/server-manifest', 'ssr'],
		['ogygia:server/server-regions', 'ssr']
	] as const)('%s (%s)', async (spec, leg) => {
		const files = app({ wire: true });
		const first = await load(cold(files), spec, leg);
		expect(first).toBe(await load(warm(files), spec, leg));
	});

	it('the server island the prescan found is in the server manifest', async () => {
		const s = cold(app());
		const out = await load(s, 'ogygia:server/server-manifest', 'ssr');
		expect(out).toContain(SERVER_MAP_TOKENS.region_url);
		const maps = server_manifest_maps(s.compiler.program, (iid) => iid);
		expect(Object.keys(maps.region_url)).toEqual([expect.stringMatching(/^[0-9a-f]{12}$/)]);
		expect(Object.values(maps.region_name)).toEqual(['Late']);
	});
});

describe('what each mode and leg is told', () => {
	it('dev boots every runtime flag; a build only what the app uses', async () => {
		// an app with no region at all: nothing in it needs a frame
		const bare = { [`${ROUTES}/+page.svelte`]: '<h1>page</h1>\n' };
		const dev = await load(warm(bare, true), 'ogygia:boot/runtime-flags', 'client');
		const build = await load(warm(bare), 'ogygia:boot/runtime-flags', 'client');
		expect(dev).toMatch(/^export const FRAMES = true;\nexport const load_wire_codec = null;\n$/);
		expect(build).toMatch(
			/^export const FRAMES = false;\nexport const load_wire_codec = \(\) => import\(/
		);
	});

	it('the browser bundle carries no fn manifest, wired or not (the page inlines it)', async () => {
		const plain = await load(warm(app()), 'ogygia:boot/hydrate-features', 'client');
		const wired = await load(warm(app({ wire: true })), 'ogygia:boot/hydrate-features', 'client');
		expect(plain).not.toMatch(/fn-manifest/);
		expect(wired).not.toMatch(/fn-manifest/);
	});

	it('kit transport carries the codec cluster only when the app crosses the wire', async () => {
		const plain = await load(warm(app()), 'ogygia:region/kit-transport', 'client');
		const wired = await load(warm(app({ wire: true })), 'ogygia:region/kit-transport', 'client');
		expect(plain).not.toBe(wired);
	});

	it('the transportables of a region entry are eager on the server, nothing in the browser', async () => {
		expect(await load(warm(app()), 'ogygia:region/transportables-eager', 'client')).toBe(
			'export {};\n'
		);
	});

	it('the signing key reaches the server leg only', async () => {
		expect(await load(warm(app()), 'ogygia:server/secret', 'ssr')).toContain('dst-secret');
		await expect(load(warm(app()), 'ogygia:server/secret', 'client')).rejects.toThrow(
			/server module/
		);
	});

	it('a build with no salt says it had no secret', async () => {
		expect(await load(warm(app()), 'ogygia:server/secret', 'ssr')).toMatch(
			/build_had_secret\W+false/
		);
	});

	it('no Kit wire path: the kit-wire module is empty', async () => {
		expect(await load(warm(app()), 'ogygia:server/kit-wire', 'ssr')).toBe(null);
	});

	it('profiler maps only in a measured build', async () => {
		expect(await load(warm(app()), 'ogygia:server/profiler-maps', 'ssr')).toMatch(
			/profiler_maps\W+null/
		);
	});
});
