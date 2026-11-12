/**
 * The rules (#313) never ship: a production build of the runtime (the boot with the router) and of
 * the server's response path carries none of them, while a build made with them on (`OGYGIA_RULES=1`
 * → `__OGYGIA_RULES__`, the e2e suites') carries every one. Built for real with rolldown, the
 * bundler the app's build uses, at the defines the plugin sets.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const RUNTIME_RULES = [
	'rule_region_mounted_twice',
	'rule_address_bar_drift',
	'rule_old_page_open',
	'rule_failure_uncoded',
	'__ogygia_rules'
];
/** What the server's rules say (their codes are in the server's message table, which ships with
 *  every server build: what must not ship is the checks). */
const SERVER_RULES = ['still open after their response ended'];

/** One production bundle of `entry` (its code), with the rules on or off. */
async function build(entry: string, rules: boolean): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'og-rules-'));
	const file = join(dir, 'entry.mjs');
	writeFileSync(file, entry);
	const bundle = await rolldown({
		input: file,
		external: [/^svelte(\/|$)/, /^\$app\//, 'esm-env', /\.svelte$/, /^node:/],
		transform: {
			define: {
				'import.meta.env.DEV': 'false',
				'import.meta.env.MODE': '"production"',
				__OGYGIA_DEVTOOLS__: 'false',
				__OGYGIA_CLIENT_PLUGINS__: 'false',
				__OGYGIA_RULES__: String(rules)
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	return output.map((o) => ('code' in o ? o.code : '')).join('\n');
}

const RUNTIME_ENTRY =
	`import { boot } from ${JSON.stringify(SRC + 'runtime/core.ts')};\n` +
	`import { install } from ${JSON.stringify(SRC + 'runtime/router.ts')};\n` +
	`boot([install]);\n`;
// The response path, and the checks installed as the handle installs them (hooks.ts: its `RULES`
// guard, word for word; the handle itself reads virtual modules a bare build cannot resolve).
const SERVER_ENTRY =
	`export { own_response } from ${JSON.stringify(SRC + 'plugin/request-scope.ts')};\n` +
	`export { flights } from '@ogygia/machine';\n` +
	`import { install_server_rules } from ${JSON.stringify(SRC + 'server/rules.ts')};\n` +
	`const RULES = import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);\n` +
	`if (RULES) install_server_rules();\n`;

describe('rules never ship in a production build', () => {
	it('the runtime boot with its router: none of them off, every one on', async () => {
		const off = await build(RUNTIME_ENTRY, false);
		const on = await build(RUNTIME_ENTRY, true);
		for (const code of RUNTIME_RULES) {
			expect(off, code).not.toContain(code);
			expect(on, code).toContain(code);
		}
		// what they would cost a visitor, and do not
		const brotli = (s: string) => brotliCompressSync(Buffer.from(s)).length;
		expect(brotli(on)).toBeGreaterThan(brotli(off));
	}, 60_000);

	it("the server's response path: none of them off, every one on", async () => {
		const off = await build(SERVER_ENTRY, false);
		const on = await build(SERVER_ENTRY, true);
		for (const check of SERVER_RULES) {
			expect(off, check).not.toContain(check);
			expect(on, check).toContain(check);
		}
		// on, the response path notes each response's end for them too
		expect(off.length).toBeLessThan(on.length);
		expect(on).not.toBe(off);
	}, 60_000);
});

// Buggify points (@ogygia/machine `buggify`): the rare branches a simulated run takes on purpose.
// Each sits behind the rules gate, so a production build carries no call and no point's name.
const RUNTIME_POINTS = ['flights.not-kept', 'import-again.entry-missed', 'hole.fetch-lost'];
const SERVER_POINTS = [
	'flights.not-kept',
	'outbox.reply-lost',
	'federation.doc-stale',
	'postrender.store-down'
];
const SERVER_POINTS_ENTRY =
	SERVER_ENTRY +
	// (by path: a bare name does not resolve from the entry's temporary folder)
	`export { outbox } from ${JSON.stringify(SRC + '../../machine/src/outbox.ts')};\n` +
	`export { PeerHandle } from ${JSON.stringify(SRC + '../../federation/src/peer.ts')};\n` +
	`export { store_get } from ${JSON.stringify(SRC + '../../postrender/src/registry.ts')};\n`;

describe('buggify points never ship in a production build', () => {
	it('the runtime boot: none of them off, every one on', async () => {
		const off = await build(RUNTIME_ENTRY, false);
		const on = await build(RUNTIME_ENTRY, true);
		for (const point of RUNTIME_POINTS) {
			expect(off, point).not.toContain(point);
			expect(on, point).toContain(point);
		}
	}, 60_000);

	it("the server's response path, with an outbox and a federation peer: none off, every one on", async () => {
		const off = await build(SERVER_POINTS_ENTRY, false);
		const on = await build(SERVER_POINTS_ENTRY, true);
		for (const point of SERVER_POINTS) {
			expect(off, point).not.toContain(point);
			expect(on, point).toContain(point);
		}
		// (nor the platform hook it asks)
		expect(off).not.toContain('buggify');
	}, 60_000);
});
