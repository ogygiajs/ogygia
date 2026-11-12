import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eval_sites } from './built-no-eval.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'built-no-eval.ts');
const whats = (code: string) => eval_sites(code, 'x.js').map((s) => s.what);

test('every way built code turns a string into code is found', () => {
	assert.deepEqual(whats('eval(s)'), ['eval(…)']);
	assert.deepEqual(whats('(0, eval)(s)'), ['eval(…)']);
	assert.deepEqual(whats('globalThis.eval(s); window["eval"](s)'), ['eval(…)', 'eval(…)']);
	assert.deepEqual(whats('new Function("a", s)'), ['new Function(…)']);
	assert.deepEqual(whats('Function(s)()'), ['Function(…)']);
	assert.deepEqual(whats('self.Function(s)'), ['Function(…)']);
	assert.deepEqual(whats('setTimeout("go()", 1); setInterval(`x${y}`, 9)'), [
		'setTimeout(<string>)',
		'setInterval(<string>)'
	]);
	assert.deepEqual(
		eval_sites(
			`a
b
eval(s)`,
			'x.js'
		)[0].line,
		3
	);
});

test('what only looks like it is left alone', () => {
	assert.deepEqual(
		whats(`const m = { eval: 1 }; m.eval(s); obj.Function(s);
"eval(s)"; // eval(s)
/eval\\(/.test(s);
setTimeout(() => go(), 1); setTimeout(fn, 1);
class A { eval() {} }`),
		[]
	);
	assert.deepEqual(whats('export const x = 1; import("./y.js");'), []);
});

test('the script fails naming the file, passes a clean tree, and fails on an empty one', () => {
	const dir = mkdtempSync(join(tmpdir(), 'built-no-eval-'));
	try {
		const run = (d: string) => spawnSync(process.execPath, [SCRIPT, d], { encoding: 'utf8' });
		mkdirSync(join(dir, 'empty'));
		assert.equal(run(join(dir, 'empty')).status, 1);
		mkdirSync(join(dir, 'ok', 'node_modules'), { recursive: true });
		writeFileSync(join(dir, 'ok', 'a.js'), 'export const a = 1;');
		writeFileSync(join(dir, 'ok', 'node_modules', 'dep.js'), 'eval(s)'); // not ours to ship
		assert.equal(run(join(dir, 'ok')).status, 0);
		writeFileSync(join(dir, 'ok', 'b.mjs'), 'export const b = () => new Function(s);');
		const bad = run(join(dir, 'ok'));
		assert.equal(bad.status, 1);
		assert.match(bad.stderr, /b\.mjs:1 {2}new Function/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
