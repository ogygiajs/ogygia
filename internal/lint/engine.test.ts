// The type-aware half of `pnpm lint` runs in a second program, tsgolint (the `oxlint-tsgolint`
// package). When it runs but reports nothing (a broken install, a stub on the path, `typeAware`
// dropped from the config), oxlint counts zero type-aware hits and passes. `engine.ts` runs before
// oxlint in `pnpm lint` and fails unless the engine reports a hit it must report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GUARD = path.join(ROOT, 'internal/lint/engine.ts');

/** Runs the guard with `env` added, and returns its exit code and output. */
function guard(env: Record<string, string>): { code: number | null; out: string } {
	const run = spawnSync(process.execPath, [GUARD], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, ...env }
	});
	return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

/** A stand-in tsgolint that reads its input, prints nothing and exits 0. */
function silent_engine(dir: string): string {
	const file = path.join(dir, 'tsgolint');
	writeFileSync(
		file,
		dedent`
			#!/bin/sh
			cat >/dev/null
			exit 0
		`
	);
	chmodSync(file, 0o755);
	return file;
}

test('the guard passes when the installed type-aware engine reports', () => {
	const run = guard({});
	assert.equal(run.code, 0, run.out);
});

test('the guard fails out loud when the type-aware engine runs but reports nothing', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-lint-engine-'));
	try {
		const run = guard({ OXLINT_TSGOLINT_PATH: silent_engine(dir) });
		assert.equal(run.code, 1, run.out);
		assert.match(run.out, /type-aware lint engine/);
		assert.match(run.out, /pnpm install --offline/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the guard fails out loud when the type-aware engine is missing', () => {
	const run = guard({ OXLINT_TSGOLINT_PATH: path.join(tmpdir(), 'og-no-such-tsgolint') });
	assert.equal(run.code, 1, run.out);
	assert.match(run.out, /type-aware lint engine/);
});

test('pnpm lint runs the guard before oxlint', () => {
	const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
		scripts: Record<string, string>;
	};
	assert.match(pkg.scripts.lint ?? '', /node internal\/lint\/engine\.ts && .*\boxlint$/);
});
