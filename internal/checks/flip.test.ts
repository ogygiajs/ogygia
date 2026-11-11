// node --test internal/checks/flip.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const flip = join(dirname(fileURLToPath(import.meta.url)), 'flip.ts');

/** Flips `find` to `replace` in a file, with a command that fails only when the file holds `replace` exactly. */
function flip_to(text: string, find: string, replace: string) {
	const dir = mkdtempSync(join(tmpdir(), 'flip-'));
	try {
		const file = join(dir, 'code.ts');
		writeFileSync(file, text);
		const check = `process.exit(require('fs').readFileSync(${JSON.stringify(file)}, 'utf8').includes(${JSON.stringify(replace)}) ? 1 : 0)`;
		const r = spawnSync(
			process.execPath,
			[
				flip,
				'--file',
				file,
				'--find',
				find,
				'--replace',
				replace,
				'--',
				process.execPath,
				'-e',
				check
			],
			{ encoding: 'utf8' }
		);
		return { status: r.status, out: r.stdout + r.stderr, after: readFileSync(file, 'utf8') };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('the flip writes the --replace text exactly, dollar signs included', () => {
	for (const replace of ['a !== b || $$x', '$&', "$'", '$`']) {
		const r = flip_to('const same = a === b;\n', 'a === b', replace);
		assert.equal(r.status, 0, `${replace}: ${r.out}`);
		assert.match(r.out, /\| red: /);
	}
});

test('the file is put back after the flip', () => {
	const r = flip_to('const same = a === b;\n', 'a === b', 'a !== b');
	assert.equal(r.status, 0, r.out);
	assert.equal(r.after, 'const same = a === b;\n');
});
