import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dedent } from '../../packages/core/src/contract/dedent.ts';
import { image_drift } from './playwright-image.ts';

const DIGEST = 'a'.repeat(64);

function repo(opts: { catalog?: string; locked?: string[]; workflows: Record<string, string> }) {
	const root = mkdtempSync(join(tmpdir(), 'playwright-image-'));
	mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
	writeFileSync(
		join(root, 'pnpm-workspace.yaml'),
		dedent`
			packages:
			  - packages/*
			catalog:
			  # tests
			  '@playwright/test': ${opts.catalog ?? '1.62.1'}
			  playwright: ^1.62.1
			catalogs:
			  peers:
			    '@playwright/test': ^1.62.0
		`
	);
	const locked = opts.locked ?? ['1.62.1'];
	writeFileSync(
		join(root, 'pnpm-lock.yaml'),
		[
			'packages:',
			...locked.map((v) => `  playwright-core@${v}:`),
			'snapshots:',
			...locked.map((v) => `  playwright-core@${v}: {}`)
		].join('\n')
	);
	for (const [name, body] of Object.entries(opts.workflows))
		writeFileSync(join(root, '.github', 'workflows', name), body);
	return root;
}

const job = (ref: string) => dedent`
	jobs:
	  run:
	    container:
	      image: mcr.microsoft.com/playwright:${ref}
`;

test('an image pinned by digest to the locked Playwright passes', () => {
	const root = repo({ workflows: { 'e2e.yml': job(`v1.62.1-resolute@sha256:${DIGEST}`) } });
	assert.deepEqual(image_drift(root), []);
});

test('the real workflows name only the locked Playwright, by digest', () => {
	assert.deepEqual(image_drift(join(import.meta.dirname, '..', '..')), []);
});

test('a Playwright bump without the image fails, naming the workflow', () => {
	const root = repo({
		catalog: '1.63.0',
		locked: ['1.63.0'],
		workflows: { 'e2e.yml': job(`v1.62.1-resolute@sha256:${DIGEST}`) }
	});
	const problems = image_drift(root);
	assert.equal(problems.length, 1);
	assert.match(
		problems[0]!,
		/e2e\.yml: the image is Playwright 1\.62\.1, the lockfile resolves 1\.63\.0/
	);
});

test('an image by tag alone, without its digest, fails', () => {
	const root = repo({ workflows: { 'dst.yml': job('v1.62.1-resolute') } });
	assert.match(image_drift(root)[0]!, /dst\.yml: .* is not v<version>-<distro>@sha256:<digest>/);
});

test('a catalog range or a version the lockfile does not resolve fails', () => {
	const root = repo({ catalog: '^1.62.0', workflows: {} });
	assert.match(image_drift(root)[0]!, /the catalog's '@playwright\/test' is \^1\.62\.0/);
});

test('two locked Playwright versions fail: one image carries one', () => {
	const root = repo({ locked: ['1.62.1', '1.61.0'], workflows: {} });
	assert.match(image_drift(root)[0]!, /resolves 2 playwright-core versions/);
});
