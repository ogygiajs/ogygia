/**
 * The input recorder for the unit tests: off unless `HEISENBENCH_RECORD` names a targets file.
 *
 * `node internal/heisenbench/src/unmeasured.ts` (the measurement-source gate) runs each package's node
 * tests with `HEISENBENCH_RECORD=<targets.json>` and `HEISENBENCH_RECORD_OUT=<dir>`. The functions in the targets
 * file (those no bench file runs) then record the inputs and outputs of their calls while the tests
 * run (Heisenbench's recording transform), and every test file saves what it recorded into the directory
 * when it ends (record-save.ts). Those inputs, replayed, are the functions' measurement source.
 *
 * Without the variables the plugin list is empty: an ordinary test run is untouched.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SAVE = fileURLToPath(new URL('./record-save.ts', import.meta.url));

interface TransformPlugin {
	transform(code: string, id: string): { code: string; map: object } | null;
}

interface RecordPluginFactory {
	heisenbench_record_plugin(o: {
		targets: Record<string, string[]>;
		root: string;
		on_skipped: (skipped: Array<{ id: string; reason: string }>) => void;
	}): TransformPlugin;
}

/** A test file of a package (`packages/<pkg>/test/**\/*.test.ts`). */
function is_test_file(file: string): boolean {
	return file.startsWith(join(REPO_ROOT, 'packages')) && file.endsWith('.test.ts');
}

export function heisenbench_record(): Array<{
	name: string;
	enforce: 'post';
	transform(code: string, id: string): Promise<{ code: string; map?: object | null } | null>;
}> {
	const targets_file = process.env.HEISENBENCH_RECORD;
	const out = process.env.HEISENBENCH_RECORD_OUT;
	if (!targets_file || !out) return [];
	const targets = JSON.parse(readFileSync(targets_file, 'utf8')) as Record<string, string[]>;
	const skipped_file = join(out, 'skipped.txt');
	let inner: Promise<TransformPlugin> | null = null;
	// Heisenbench is linked at node_modules/@bench/heisenbench (internal/heisenbench/src/heisenbench.ts); loaded by Node itself,
	// not bundled with the config.
	const load = (): Promise<TransformPlugin> =>
		(inner ??= (
			import(
				pathToFileURL(join(REPO_ROOT, 'node_modules/@bench/heisenbench/src/coverage/plugin.ts'))
					.href
			) as Promise<RecordPluginFactory>
		).then((m) =>
			m.heisenbench_record_plugin({
				targets,
				root: REPO_ROOT,
				on_skipped: (s) => appendFileSync(skipped_file, s.map((x) => `${x.id}\n`).join(''))
			})
		));
	return [
		{
			name: 'ogygia:heisenbench-record',
			enforce: 'post',
			async transform(code, id) {
				const file = id.split('?')[0];
				if (is_test_file(file)) {
					return { code: `import ${JSON.stringify(SAVE)};\n${code}`, map: null };
				}
				return (await load()).transform(code, id);
			}
		}
	];
}
