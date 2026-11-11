/**
 * EACH LAZY LOADER'S OWN FILE (#385, #392). A lazy loader (`import_again(() => import('./x.ts'))`,
 * runtime/import-again.ts) asks for its file again under a fresh URL after a download fails. Which
 * file that is, the failure cannot say: WebKit's error names none, and Firefox's names the file that
 * failed, which can be a dependency of the one imported. The build can, so it hands each loader its
 * own:
 *
 * - each `import_again(() => import('<spec>'))` becomes
 *   `import_again(() => import('<spec>'), void 0, <file>, import.meta.url)`. Code that writes its
 *   loaders out another way (the transportable classes' map) puts a `file_token` beside each
 *   (compiler/link/file-token.ts);
 * - dev: the file is the module's URL: a relative spec as written, another the resolved file under
 *   `/@fs/`;
 * - build: once chunks are named, the path from the loader's chunk to the module's own chunk, or
 *   `null` when the module has none (it shares a chunk with others: the bundler reads it out of that
 *   chunk's exports, which a plain import of the file would not).
 */
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import {
	FILE_TOKEN_MARK,
	FILE_TOKEN_RE,
	file_token,
	file_token_id
} from '../compiler/link/file-token.ts';

/** A loader whose file is not given yet: a bare arrow that imports one string. */
const LOADER_RE = /\bimport_again\(\s*\(\)\s*=>\s*import\(\s*(["'`])([^"'`]+)\1\s*\)\s*\)/g;

/** `id`'s URL on the dev server; `null` for a module with no file (a virtual one). */
function dev_url(id: string): string | null {
	if (id.startsWith('\0')) return null;
	return `/@fs/${id.replace(/^\/+/, '')}`;
}

/** The path from the chunk `from` to the file `to` (both bundle-relative), as an import spells it. */
function relative_file(from: string, to: string): string {
	const up = from.split('/').slice(0, -1);
	const down = to.split('/');
	while (up.length && down.length > 1 && up[0] === down[0]) {
		up.shift();
		down.shift();
	}
	return up.length ? `${'../'.repeat(up.length)}${down.join('/')}` : `./${down.join('/')}`;
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
					const [whole, quote, spec] = m;
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
					s.overwrite(
						m.index,
						m.index + whole.length,
						`import_again(() => import(${quote}${spec}${quote}), void 0, ${file ?? 'null'}, import.meta.url)`
					);
				}
			if (tokens)
				for (const m of code.matchAll(FILE_TOKEN_RE))
					s.overwrite(m.index, m.index + m[0].length, JSON.stringify(dev_url(file_token_id(m[2]))));
			if (!s.hasChanged()) return null;
			return { code: s.toString(), map: s.generateMap({ hires: true }) };
		},
		renderChunk(code, chunk, _options, meta) {
			if (!code.includes(FILE_TOKEN_MARK)) return null;
			const own = new Map<string, string>();
			for (const c of Object.values(meta.chunks))
				if (c.facadeModuleId) own.set(c.facadeModuleId, c.fileName);
			const s = new MagicString(code);
			for (const m of code.matchAll(FILE_TOKEN_RE)) {
				const file = own.get(file_token_id(m[2]));
				s.overwrite(
					m.index,
					m.index + m[0].length,
					file === undefined ? 'null' : JSON.stringify(relative_file(chunk.fileName, file))
				);
			}
			if (!s.hasChanged()) return null;
			return { code: s.toString(), map: s.generateMap({ hires: true }) };
		}
	};
}
