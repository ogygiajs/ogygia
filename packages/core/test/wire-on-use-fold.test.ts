import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { dedent } from '../src/contract/dedent.ts';
import { REF_WIRE_KEY } from '../src/ref-key.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The boot's use of `wire_for_wake`, built with `load_wire_codec` as the build's flags set it. */
async function build(load_wire_codec: string): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'og-wire-on-use-'));
	const file = join(dir, 'entry.mjs');
	writeFileSync(
		file,
		dedent`
			import { wire_for_wake } from ${JSON.stringify(`${SRC}runtime/wire-on-use.ts`)};
			export const wake = (el) => wire_for_wake(el);
		`
	);
	const bundle = await rolldown({
		input: file,
		external: [/^svelte(\/|$)/, /^\$app\//, 'esm-env', /\.svelte$/, /^node:/, 'codec'],
		plugins: [
			{
				name: 'boot-flags',
				resolveId: (id) => (id === 'ogygia:boot' ? '\0ogygia:boot' : null),
				load: (id) =>
					id === '\0ogygia:boot' ? `export const load_wire_codec = ${load_wire_codec};` : null
			}
		],
		transform: {
			define: {
				'import.meta.env.DEV': 'false',
				'import.meta.env.MODE': '"production"',
				__OGYGIA_DEVTOOLS__: 'false',
				__OGYGIA_RULES__: 'false'
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	return output.map((o) => ('code' in o ? o.code : '')).join('\n');
}

it('a build with the wire codec in it carries none of the load-on-use code', async () => {
	const with_codec = await build('null');
	const on_use = await build(`() => import('codec')`);
	expect(on_use).toContain('wire codec');
	expect(with_codec).not.toContain('wire codec');
	expect(with_codec).not.toContain(REF_WIRE_KEY);
}, 60_000);
