import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { current_map, MAP_FILE, scan_file } from './attack-surface.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('the attack-surface map is the one the code makes now (run node internal/checks/attack-surface.ts)', () => {
	assert.equal(readFileSync(path.join(ROOT, MAP_FILE), 'utf8'), current_map());
});

test('an entry names its file, the function it sits in, and what it does, with a count', () => {
	const src = [
		'export function read(request: Request) {',
		"\tconst a = request.headers.get('x-a');",
		"\tconst b = request.headers.get('x-a');",
		'\treturn JSON.parse(a + b);',
		'}',
		'const top = atob(x);',
		'class C {',
		'\t#write(el: Element, html: string) {',
		'\t\tel.innerHTML = html;',
		'\t\tif (el.innerHTML == html) return;',
		'\t}',
		'}'
	].join('\n');
	assert.deepEqual(
		scan_file('a.ts', src)
			.map((e) => `${e.kind} ${e.where} ${e.what} ${e.count}`)
			.sort(),
		[
			'decode read JSON.parse 1',
			'decode top atob 1',
			'html #write innerHTML = 1',
			"request read headers.get('x-a') 2"
		]
	);
});

test('comments, secrets and routes', () => {
	const src = [
		'// el.innerHTML = x (a comment is not a sink)',
		'export function key() {',
		'\treturn createHmac("sha256", process.env.OGYGIA_SECRET);',
		'}',
		"export const PATH = '/og/thaw';"
	].join('\n');
	assert.deepEqual(
		scan_file('b.ts', src)
			.map((e) => `${e.kind} ${e.where} ${e.what}`)
			.sort(),
		['route PATH /og/thaw', 'secret key createHmac', 'secret key env OGYGIA_SECRET']
	);
});
