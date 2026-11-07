/**
 * Type-check the bench files: `node internal/heisenbench/src/check.ts` (or `pnpm check:bench`).
 *
 * Writes their types first (types.ts), then runs `tsc -p packages/<pkg>/bench` for every package
 * with bench files. Each bench tsconfig extends its package's and includes the package source, so
 * the source's own ambient declarations (virtual modules, Svelte) apply.
 */
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench_packages, REPO_ROOT } from './heisenbench.ts';

const TYPES = fileURLToPath(new URL('./types.ts', import.meta.url));
const TSC = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

execFileSync(process.execPath, [TYPES], { cwd: REPO_ROOT, stdio: 'inherit' });

let failed = 0;
for (const pkg of bench_packages()) {
	const project = join(pkg.dir, 'bench');
	try {
		execFileSync(TSC, ['-p', project], { cwd: REPO_ROOT, stdio: 'inherit' });
		console.log(`${relative(REPO_ROOT, project)}: ok`);
	} catch {
		failed++;
		console.error(`${relative(REPO_ROOT, project)}: type errors`);
	}
}
process.exitCode = failed > 0 ? 1 : 0;
