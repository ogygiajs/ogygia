/**
 * A production build moves core's machines by their states' ints (internal/macros machine-sites.ts):
 * the runtime boot, built for real with rolldown at the defines the plugin sets, has no call site
 * that names a state of a `$machine` definition, and a rules build names every one it moves. A site
 * the build missed would name its state here, and move an int machine by name in the field.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { MachineTypes } from 'ogygia-internal-macros/plugin';
import { dedent } from '../src/contract/dedent.ts';
import { MACRO_TYPES, core_macros } from '../macros.config.ts';
import { feature_code } from './_boot-bundle.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Every state name of core's `$machine` definitions. */
function state_names(): Set<string> {
	const types = new MachineTypes(MACRO_TYPES);
	return new Set(types.definitions(types.typed.program).flatMap((d) => d.names));
}

/** One bundle of the runtime boot (every chunk's code), production or rules. */
async function build(rules: boolean): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'og-ints-'));
	const file = join(dir, 'entry.mjs');
	writeFileSync(
		file,
		`${dedent`
			import { boot } from ${JSON.stringify(`${SRC}runtime/core.ts`)};
			boot();
		`}\n`
	);
	const bundle = await rolldown({
		input: file,
		external: [/^svelte(\/|$)/, /^\$app\//, 'esm-env', /\.svelte$/, /^node:/],
		plugins: [core_macros(), feature_code(SRC, ['router', 'lakes'])],
		transform: {
			define: {
				'import.meta.env.DEV': 'false',
				'import.meta.env.MODE': '"production"',
				__OGYGIA_DEVTOOLS__: 'false',
				__OGYGIA_RULES__: String(rules)
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'esm', minify: true });
	await bundle.close();
	return output.map((o) => ('code' in o ? o.code : '')).join('\n');
}

const QUOTE = '[`"\']';
const MOVES_RE = new RegExp(`\\.(?:go|move|wait)\\((${QUOTE})(\\w+)\\1`, 'g');
const KINDS_RE = new RegExp(`\\.kind[!=]==?(${QUOTE})(\\w+)\\1|case(${QUOTE})(\\w+)\\3`, 'g');

/** The states of `names` that `code` moves or compares by name. */
function named(code: string, names: ReadonlySet<string>): string[] {
	const found = new Set<string>();
	for (const m of code.matchAll(MOVES_RE)) if (names.has(m[2]!)) found.add(`move ${m[2]}`);
	for (const m of code.matchAll(KINDS_RE)) {
		const name = m[2] ?? m[4]!;
		if (names.has(name)) found.add(`kind ${name}`);
	}
	return [...found].sort();
}

describe('a production build names no machine state', () => {
	it('the runtime boot moves and reads its machines by int; a rules build by name', async () => {
		const names = state_names();
		const prod = named(await build(false), names);
		// (`case 'empty'` is the lakes' remount mode, region-attrs.ts `region_remount`: no machine's)
		expect(prod, 'only `kept`, a flights entry’s own state (a machine with names)').toEqual([
			'kind empty',
			'kind kept'
		]);
		expect(await build(false)).toContain('case`empty`:return');
		const rules = named(await build(true), names);
		expect(rules).toContain('move armed');
		expect(rules).toContain('kind fetching');
		expect(rules.length).toBeGreaterThan(40);
	}, 60_000);
});
