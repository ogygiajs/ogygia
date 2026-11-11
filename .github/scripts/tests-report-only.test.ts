import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'tests-report-only.ts');

function repo(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), 'tests-report-only-'));
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
			cwd: dir,
			encoding: 'utf8'
		});
	git('init', '-q');
	for (const [f, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, f)), { recursive: true });
		writeFileSync(join(dir, f), body);
	}
	git('add', '-A');
	git('commit', '-qm', 'base');
	const base = git('rev-parse', 'HEAD').trim();
	const guard = () => spawnSync('node', [GUARD, base], { cwd: dir, encoding: 'utf8' });
	return { dir, git, guard };
}

test('a tests-report PR that only adds report files passes', () => {
	const r = repo({ 'packages/core/src/x.ts': 'export const x = 1;\n' });
	try {
		mkdirSync(join(r.dir, 'apps/docs/static/tests/1.0.0'), { recursive: true });
		writeFileSync(join(r.dir, 'apps/docs/static/tests/1.0.0/summary.json'), '{}\n');
		r.git('add', '-A');
		r.git('commit', '-qm', 'report');
		assert.equal(r.guard().status, 0);
	} finally {
		rmSync(r.dir, { recursive: true, force: true });
	}
});

test('a tests-report PR that moves a source file into the report folder fails', () => {
	const r = repo({ 'packages/core/src/x.ts': 'export const x = 1;\n' });
	try {
		mkdirSync(join(r.dir, 'apps/docs/static/tests'), { recursive: true });
		r.git('mv', 'packages/core/src/x.ts', 'apps/docs/static/tests/x.ts');
		r.git('commit', '-qm', 'move');
		const out = r.guard();
		assert.equal(out.status, 1);
		assert.match(out.stderr, /packages\/core\/src\/x\.ts/);
	} finally {
		rmSync(r.dir, { recursive: true, force: true });
	}
});
