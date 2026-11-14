/**
 * Type-aware lint (`oxlint --type-aware`) reads every tsconfig, and a Kit app's extends
 * `./.svelte-kit/tsconfig.json`, which only `svelte-kit sync` writes. This syncs each tracked Kit
 * app that has none yet, all at once, before `oxlint` runs (`pnpm lint`). An app synced already is
 * left alone, so a second run costs nothing.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

const tsconfigs = execFileSync('git', ['ls-files', '*tsconfig.json'], {
	cwd: root,
	encoding: 'utf8'
})
	.split('\n')
	.filter(Boolean);

const apps = tsconfigs
	.filter((f) => readFileSync(path.join(root, f), 'utf8').includes('./.svelte-kit/tsconfig.json'))
	.map((f) => path.join(root, path.dirname(f)))
	.filter((dir) => !existsSync(path.join(dir, '.svelte-kit', 'tsconfig.json')))
	.filter((dir) => existsSync(path.join(dir, 'node_modules', '.bin', 'svelte-kit')));

const failed: string[] = [];
await Promise.all(
	apps.map(
		(dir) =>
			new Promise<void>((done) => {
				const child = spawn(path.join(dir, 'node_modules', '.bin', 'svelte-kit'), ['sync'], {
					cwd: dir,
					stdio: ['ignore', 'ignore', 'pipe']
				});
				let err = '';
				child.stderr.on('data', (d: Buffer) => (err += d.toString()));
				child.on('close', (code) => {
					if (code !== 0) failed.push(`${path.relative(root, dir)}: ${err.trim()}`);
					done();
				});
			})
	)
);

if (failed.length) {
	console.error(`svelte-kit sync failed before lint:\n${failed.join('\n')}`);
	process.exit(1);
}
