// `check()` (src/e2e/index.ts) is a soft assertion: run under Playwright, every check in a test
// runs, each failure is reported by its name and extra, and the test fails once, at the end.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const PLAYWRIGHT = fileURLToPath(new URL('../node_modules/.bin/playwright', import.meta.url));
const CONFIG = fileURLToPath(new URL('./fixtures/checks/playwright.config.ts', import.meta.url));
const RULES_CONFIG = fileURLToPath(
	new URL('./fixtures/rules/playwright.config.ts', import.meta.url)
);

it('check(): every check runs, each failure is named with its extra, the test fails once at the end', () => {
	const dir = mkdtempSync(join(tmpdir(), 'e2e-check-'));
	try {
		const trail = join(dir, 'trail.txt');
		const r = spawnSync(PLAYWRIGHT, ['test', '-c', CONFIG, '--output', join(dir, 'out')], {
			encoding: 'utf8',
			env: { ...process.env, CHECKS_TRAIL: trail, CI: '' }
		});
		const out = r.stdout + r.stderr;
		expect(r.status, out).toBe(1);
		expect(readFileSync(trail, 'utf8')).toBe('reached the end\n');
		expect(out).toContain('first fails — measured 3');
		expect(out).toContain('third fails');
		expect(out).not.toContain('second passes');
		expect(out).toMatch(/1 failed/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 60_000);

it('a page where ogygia booted without its rules fails the rules check, naming why (#1272)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'e2e-rules-'));
	try {
		const r = spawnSync(PLAYWRIGHT, ['test', '-c', RULES_CONFIG, '--output', join(dir, 'out')], {
			encoding: 'utf8',
			env: { ...process.env, CI: '' }
		});
		const out = r.stdout + r.stderr;
		expect(r.status, out).toBe(1);
		expect(out).toMatch(/1 failed/);
		expect(out).toMatch(/3 passed/);
		expect(out).toContain('ogygia booted, built without its rules');
		expect(out).toContain('built without its rules (OGYGIA_RULES=1)');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 60_000);

it('the siblings import by file name, `.ts` and all, from @ogygia/tooling/e2e/*', async () => {
	expect(Object.keys(await import('@ogygia/tooling/e2e/servers.ts'))).toContain('spawn_server');
	expect(Object.keys(await import('@ogygia/tooling/e2e/re.ts'))).toContain(
		'ISLAND_GRAPH_SCRIPT_G_RE'
	);
	expect(Object.keys(await import('@ogygia/tooling/e2e/packed.ts'))).toContain('pack_ogygia');
	expect(Object.keys(await import('@ogygia/tooling/e2e/config.ts'))).toContain('suite');
	expect(Object.keys(await import('@ogygia/tooling/e2e/build.ts'))).toContain('build_app');
});
