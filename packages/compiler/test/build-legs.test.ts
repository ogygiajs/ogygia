// One record per bundler environment in a build (src/compiler/leg.ts): Kit 3 builds `ssr` then
// `client` in one plugin instance, so what one leg emits must never be read as the other's, and a
// hook the bundler calls without an environment is placed only when one leg is open.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

let root = '';
beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-legs-'));
	const files: Record<string, string> = {
		'src/routes/+layout.ts': 'export const csr = false;\n',
		'src/routes/+page.svelte': `${dedent`
			<script>
				import W from '$lib/W.svelte' with { wake: 'visible' };
			</script>
			<W />
		`}\n`,
		'src/lib/W.svelte': '<p>w</p>\n'
	};
	for (const [rel, src] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), src);
	}
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const SSR = { name: 'ssr', server: true };
const CLIENT = { name: 'client', server: false };

function make(is_build: boolean): Compiler {
	const compiler = new Compiler(new Program({ forms: true, router: true }), {
		prof: {
			transformMs: 0,
			transformN: 0,
			transformHit: 0,
			prescanMs: 0,
			resolveMs: 0,
			loadMs: 0
		} as Compiler['profiler']['prof'],
		P: false,
		outHash: new Map()
	});
	compiler.configure(
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				app_dir: '_app',
				runtime_hash: '0123456789ab',
				libDir: path.join(root, 'src/lib'),
				is_dev: !is_build,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				is_build,
				pkg_root: '/nowhere/ogygia',
				app_shims: {}
			})
		)
	);
	return compiler;
}

describe('build legs', () => {
	it('one instance, ssr then client: the client emits into its own leg, never the server’s', () => {
		const compiler = make(true);
		expect(compiler.start_leg(SSR.name, SSR.server)).toBe(true);
		compiler.prescan();
		compiler.end_leg(SSR.name);
		expect(compiler.start_leg(CLIENT.name, CLIENT.server)).toBe(false);
		const client = compiler.leg(CLIENT);
		let n = 0;
		compiler.emit_build_chunks(client, () => `ref${++n}`, { emitRuntime: true });
		expect(client.island_entry_refs.size).toBe(1);
		expect(client.runtime_entry_ref).toBe('ref1');
		const ssr = compiler.leg(SSR);
		expect(ssr.server).toBe(true);
		expect(ssr.island_entry_refs.size).toBe(0);
		expect(ssr.runtime_entry_ref).toBeNull();
	});

	it('a hook with no environment runs in the one open leg', () => {
		const compiler = make(true);
		compiler.start_leg(SSR.name, SSR.server);
		expect(compiler.leg(null).name).toBe('ssr');
		compiler.end_leg(SSR.name);
		compiler.start_leg(CLIENT.name, CLIENT.server);
		expect(compiler.leg(null).name).toBe('client');
	});

	it('a hook with no environment while two legs are open is refused', () => {
		const compiler = make(true);
		compiler.start_leg(SSR.name, SSR.server);
		compiler.start_leg(CLIENT.name, CLIENT.server);
		expect(() => compiler.leg(null)).toThrow(/no environment while 2 environments build/);
	});

	it('a build hook in an environment that never started is refused', () => {
		const compiler = make(true);
		compiler.start_leg(SSR.name, SSR.server);
		expect(() => compiler.leg(CLIENT)).toThrow(/`client`, which never started/);
	});

	it('dev opens an environment’s leg on first use, and its start still runs the once work', () => {
		const compiler = make(false);
		const early = compiler.leg(CLIENT);
		expect(compiler.start_leg(CLIENT.name, CLIENT.server)).toBe(true);
		expect(compiler.leg(CLIENT)).toBe(early);
		expect(compiler.start_leg(SSR.name, SSR.server)).toBe(false);
	});

	it('a leg the bundler ends twice ends once, without a refusal', () => {
		const compiler = make(true);
		compiler.start_leg(SSR.name, SSR.server);
		compiler.end_leg(SSR.name);
		expect(() => compiler.end_leg(SSR.name)).not.toThrow();
		expect(compiler.find_leg(SSR.name)?.life.now.kind).toBe('closed');
	});

	it('an end with no environment ends the one open leg; a dev close with two open ends none', () => {
		const build = make(true);
		build.start_leg(SSR.name, SSR.server);
		build.end_leg(null);
		expect(build.find_leg(SSR.name)?.life.now.kind).toBe('closed');
		const dev = make(false);
		dev.leg(SSR);
		dev.leg(CLIENT);
		expect(() => dev.end_leg(null)).not.toThrow();
		expect(dev.find_leg(SSR.name)?.life.now.kind).toBe('open');
		expect(dev.find_leg(CLIENT.name)?.life.now.kind).toBe('open');
	});

	it('a second build (watch) starts every leg empty', () => {
		const compiler = make(true);
		compiler.start_leg(CLIENT.name, CLIENT.server);
		compiler.prescan();
		const first = compiler.leg(CLIENT);
		compiler.emit_build_chunks(first, () => 'r', { emitRuntime: false });
		first.router_css_refs.set('rcss:a', 'r');
		compiler.end_leg(CLIENT.name);
		expect(compiler.start_leg(CLIENT.name, CLIENT.server)).toBe(true);
		const second = compiler.leg(CLIENT);
		expect(second).not.toBe(first);
		expect(second.island_entry_refs.size).toBe(0);
		expect(second.router_css_refs.size).toBe(0);
	});
});
