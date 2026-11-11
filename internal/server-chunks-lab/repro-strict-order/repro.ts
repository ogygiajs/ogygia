/**
 * The smallest repro found for the `single-lazy` hang (server-chunks.md, section 3): builds src/
 * with Rolldown in four option sets, then imports each output's entry with a 3 s limit.
 *
 *   node repro-strict-order/repro.ts
 */
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'rolldown';

const here = new URL('.', import.meta.url).pathname;
const SETS: Record<string, Record<string, unknown>> = {
	plain: {},
	'strict only': { strictExecutionOrder: true },
	'one group only': { codeSplitting: { groups: [{ name: 'all' }] } },
	'one group + strict': { codeSplitting: { groups: [{ name: 'all' }] }, strictExecutionOrder: true }
};

for (const [label, output] of Object.entries(SETS)) {
	const dir = here + 'out/' + label.replace(/\W+/g, '-');
	await rm(dir, { recursive: true, force: true });
	await build({
		input: { entry: here + 'src/entry.js', other: here + 'src/other.js' },
		output: { dir, format: 'esm', ...output },
		write: true,
		logLevel: 'silent'
	});
	const run = spawnSync(
		process.execPath,
		['--input-type=module', '-e', `await import(${JSON.stringify(dir + '/entry.js')})`],
		{ timeout: 3000, encoding: 'utf8' }
	);
	const outcome = run.error
		? 'HANGS (killed after 3 s)'
		: run.status === 0
			? 'ok: ' + run.stdout.trim()
			: 'exit ' + run.status + ': ' + (run.stderr.trim().split('\n').at(-1) ?? '');
	console.log(label.padEnd(20) + outcome);
}
