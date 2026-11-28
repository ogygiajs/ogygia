import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';
import { current_map, MAP_FILE, scan_file } from './attack-surface.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('the attack-surface map is the one the code makes now (run node internal/checks/attack-surface.ts)', () => {
	assert.equal(readFileSync(path.join(ROOT, MAP_FILE), 'utf8'), current_map());
});

test('an entry names its file, the function it sits in, and what it does, with a count', () => {
	const src = dedent`
		export function read(request: Request) {
			const a = request.headers.get('x-a');
			const b = request.headers.get('x-a');
			return JSON.parse(a + b);
		}
		const top = atob(x);
		class C {
			#write(el: Element, html: string) {
				el.innerHTML = html;
				if (el.innerHTML == html) return;
			}
		}
	`;
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
	const src = dedent`
		// el.innerHTML = x (a comment is not a sink)
		export function key() {
			return createHmac("sha256", process.env.OGYGIA_SECRET);
		}
		export const PATH = '/og/thaw';
	`;
	assert.deepEqual(
		scan_file('b.ts', src)
			.map((e) => `${e.kind} ${e.where} ${e.what}`)
			.sort(),
		['route PATH /og/thaw', 'secret key createHmac', 'secret key env OGYGIA_SECRET']
	);
});

test("a usage sample in a Svelte component's markup comment is not a surface", () => {
	const src = dedent`
		<!--
		@component
		A head script: \`{@html script((k) => k, 'og-theme')}\`

		\`\`\`ts
		export const load = async ({ url }) => url.searchParams.get('q');
		\`\`\`
		-->
		<!-- one line: {@html x} -->
		<script lang="ts">
			const q = page.url.searchParams.get('q');
		</script>
		{@html note}
	`;
	assert.deepEqual(
		scan_file('C.svelte', src)
			.map((e) => `${e.kind} ${e.where} ${e.what} ${e.count}`)
			.sort(),
		['html (module) {@html} 1', "request q searchParams('q') 1"]
	);
});

test("every call of devalue's parse is a decoder, with or without revivers, by any name it is imported as", () => {
	const src = dedent`
		import { parse, stringify } from 'devalue';
		import { parse as read_wire } from 'devalue';
		import * as devalue from 'devalue';
		export function a(el: Element) {
			return parse(el.textContent ?? '');
		}
		export function b(text: string) {
			return read_wire(text) ?? devalue.parse(decode(text), { X: (v) => v });
		}
		export function c(text: string) {
			return JSON.parse(text) ?? url.parse(text) ?? parse(text, revivers);
		}
	`;
	assert.deepEqual(
		scan_file('d.ts', src)
			.map((e) => `${e.kind} ${e.where} ${e.what} ${e.count}`)
			.sort(),
		[
			'decode a devalue parse 1',
			'decode b devalue parse 2',
			'decode c JSON.parse 1',
			'decode c devalue parse 1'
		]
	);
});

test("devalue's parse imported under a name with a $ in it is listed", () => {
	const src = dedent`
		import { parse as $parse } from 'devalue';
		import * as $dv from 'devalue';
		export function a(text: string) {
			return $parse(text) ?? $dv.parse(text);
		}
	`;
	assert.deepEqual(
		scan_file('d.ts', src).map((e) => `${e.kind} ${e.where} ${e.what} ${e.count}`),
		['decode a devalue parse 2']
	);
});

test("a parse in a file that does not import devalue's is a decoder only with revivers", () => {
	const src = dedent`
		import type { parse } from 'devalue';
		export function a(text: string) {
			return parse(text) ?? parse(text, revivers);
		}
	`;
	assert.deepEqual(
		scan_file('e.ts', src).map((e) => `${e.kind} ${e.where} ${e.what} ${e.count}`),
		['decode a devalue parse 1']
	);
});
