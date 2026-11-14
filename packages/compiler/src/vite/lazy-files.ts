import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { FILE_TOKEN_MARK, FILE_TOKEN_RE, file_token, file_token_id } from '../link/file-token.ts';

const LOADER_RE = /\bimport_again\(\s*\(\)\s*=>\s*import\(\s*(["'`])([^"'`]+)\1\s*\)/g;

function call_end(code: string, open: number): { end: number; args: number } | null {
	let depth = 0;
	let args = 1;
	let last = '';
	for (let i = open; i < code.length; i++) {
		const c = code[i];
		if (c === '"' || c === "'" || c === '`') {
			for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
			last = c;
			continue;
		}
		if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
			const close = code.indexOf(code[i + 1] === '/' ? '\n' : '*/', i + 2);
			if (close === -1) return null;
			i = code[i + 1] === '/' ? close : close + 1;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') {
			if (--depth === 0) return { end: i, args: last === ',' ? args - 1 : args };
		} else if (c === ',' && depth === 1) args++;
		if (c.trim()) last = c;
	}
	return null;
}

function dev_url(id: string): string | null {
	if (id.startsWith('\0')) return null;
	return `/@fs/${id.replace(/^\/+/, '')}`;
}

export function lazy_files(): Plugin {
	let dev = false;
	return {
		name: 'ogygia:lazy-files',
		configResolved(config) {
			dev = config.command === 'serve';
		},
		async transform(code, importer) {
			const loaders = code.includes('import_again(');
			const tokens = dev && code.includes(FILE_TOKEN_MARK);
			if (!loaders && !tokens) return null;
			const s = new MagicString(code);
			if (loaders)
				for (const m of code.matchAll(LOADER_RE)) {
					const [, , spec] = m;
					const call = call_end(code, m.index + 'import_again'.length);
					if (call === null || call.args > 2) continue;
					let file: string | null;
					if (dev && spec.startsWith('.')) file = JSON.stringify(spec);
					else {
						const resolved = await this.resolve(spec, importer);
						file =
							!resolved || resolved.external
								? null
								: dev
									? JSON.stringify(dev_url(resolved.id))
									: file_token(resolved.id);
					}
					const before = code.slice(0, call.end).trimEnd();
					s.appendLeft(
						before.endsWith(',') ? before.length - 1 : call.end,
						`${call.args === 1 ? ', void 0' : ''}, ${file ?? 'null'}, import.meta.url`
					);
				}
			if (tokens)
				for (const m of code.matchAll(FILE_TOKEN_RE))
					s.overwrite(m.index, m.index + m[0].length, JSON.stringify(dev_url(file_token_id(m[2]))));
			if (!s.hasChanged()) return null;
			return { code: s.toString(), map: s.generateMap({ hires: true }) };
		}
	};
}
