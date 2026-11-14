import { component_blocks } from './parse/scan.ts';

const MAY_STYLE = /<style/i;

export function blank_styles(code: string): string {
	if (!MAY_STYLE.test(code)) return code;
	let out = '';
	let at = 0;
	for (const b of component_blocks(code)) {
		if (b.kind !== 'style') continue;
		out += code.slice(at, b.start);
		let run = 0;
		for (let k = b.start; k < b.end; k++) {
			const c = code[k];
			if (c === '\n' || c === '\r') {
				out += ' '.repeat(run) + c;
				run = 0;
			} else run++;
		}
		out += ' '.repeat(run);
		at = b.end;
	}
	return at === 0 ? code : out + code.slice(at);
}
