// Every hand-written scan that replaced a regex answers exactly what the regex did — checked against
// the original pattern over fuzzed inputs (tags, quotes, case, Unicode spaces, split markers).
import { describe, expect, it } from 'vitest';
import { region_css_links } from '../src/server/html-scan.ts';
import { escape_amp, escape_amp_quot, escape_attr, escape_text } from '../src/escape.ts';
import { is_lower_hex, is_region_id, is_region_ttl } from '../src/server/endpoint.ts';

function fuzz(n: number, pieces: string[], seed = 1): string[] {
	let s = seed;
	const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		let x = '';
		const len = 1 + Math.floor(rnd() * 14);
		for (let k = 0; k < len; k++) x += pieces[Math.floor(rnd() * pieces.length)];
		out.push(x);
	}
	return out;
}

describe('regex replacements answer what the regex did', () => {
	it('region_css_links', () => {
		const re = /<link\b[^>]*data-ogygia-region-css[^>]*>/g;
		for (const h of fuzz(4000, [
			'<link',
			'<linker',
			'<LINK',
			' rel="stylesheet"',
			' data-ogygia-region-css',
			' data-ogygia-region-css="/x.css"',
			' href="/a.css"',
			'>',
			'x',
			'<style>',
			'<link data-ogygia-region-css href="/b.css">'
		]))
			expect(region_css_links(h)).toBe((h.match(re) || []).join(''));
	});

	it('escapes', () => {
		for (const v of fuzz(4000, [
			'&',
			'"',
			'<',
			'>',
			"'",
			'a',
			'ü',
			'/_app/x.js',
			'?a=1&b=2',
			'&amp;'
		])) {
			expect(escape_attr(v)).toBe(
				v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
			);
			expect(escape_text(v)).toBe(
				v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			);
			expect(escape_amp_quot(v)).toBe(v.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
			expect(escape_amp(v)).toBe(v.split('&').join('&amp;'));
		}
	});

	it('capability gates', () => {
		const inputs = [
			'',
			'0',
			'60',
			'1234567',
			'12345678',
			'abc',
			'9x',
			'0123456789ab',
			'deadbeef0000',
			'0123456789abc',
			'DEADBEEF0000',
			'00000000000g',
			'abcdefabcdef',
			'１２',
			'a'.repeat(64),
			'f'.repeat(63) + 'g'
		];
		for (const s of inputs) {
			expect(is_region_id(s)).toBe(/^[0-9a-f]{12}$/.test(s));
			expect(is_region_ttl(s)).toBe(/^(|[0-9]{1,7})$/.test(s));
			expect(is_lower_hex(s, 64)).toBe(/^[0-9a-f]{64}$/.test(s));
		}
	});
});
