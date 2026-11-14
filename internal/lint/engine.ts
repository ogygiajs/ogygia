/**
 * Runs before `oxlint` in `pnpm lint`: lints one probe file with the root config and fails unless
 * the type-aware engine (tsgolint) reports the floating promise in it. Without this, a missing or
 * silent engine counts zero type-aware hits and `pnpm lint` passes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const dir = mkdtempSync(path.join(tmpdir(), 'og-lint-engine-'));
const probe = path.join(dir, 'probe.ts');
writeFileSync(probe, 'Promise.resolve();\n');

const run = spawnSync(
	path.join(root, 'node_modules/.bin/oxlint'),
	['-c', path.join(root, '.oxlintrc.json'), '--format', 'unix', probe],
	{ cwd: root, encoding: 'utf8' }
);
rmSync(dir, { recursive: true, force: true });

if (!`${run.stdout}`.includes('no-floating-promises')) {
	console.error(
		[
			'The type-aware lint engine (oxlint-tsgolint) did not report a floating promise in a probe file,',
			'so every type-aware rule would pass with zero hits. Run `pnpm install --offline` and lint again.',
			`${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
		]
			.filter(Boolean)
			.join('\n')
	);
	process.exit(1);
}
