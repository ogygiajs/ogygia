/**
 * The lab's compiler slice of `with { run: 'worker' }` (a Rolldown plugin; the real one would live
 * in @ogygia/compiler beside the region attributes). For
 *
 *   import { a, b as c } from './m.ts' with { run: 'worker' };
 *
 * it emits one extra entry chunk, the worker (`import * as m from './m.ts'; serve(m)`), and rewrites
 * the import to
 *
 *   import { threaded as __og_threaded } from '<lab>/src/thread.ts';
 *   const { a, b: c } = __og_threaded(new URL('<worker chunk>', import.meta.url), () => import('./m.ts'), ['a', 'b']);
 *
 * The inline fallback is a dynamic import, so a build that runs on threads never evaluates the
 * module on the main thread (it is still bundled: dev and runtimes without threads need it).
 */
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'rolldown';

const THREAD = fileURLToPath(new URL('./src/thread.ts', import.meta.url));
const SERVE = fileURLToPath(new URL('./src/thread-worker.ts', import.meta.url));
const PREFIX = '\0og-run-worker:';
// (a line-start regex, not an AST: enough for the lab, and it skips the examples in doc comments)
const RUN_WORKER =
	/^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*with\s*\{\s*run\s*:\s*(['"])worker\4\s*\}\s*;?/gm;

export function run_worker(): Plugin {
	return {
		name: 'ogygia-lab:run-worker',
		resolveId(id) {
			return id.startsWith(PREFIX) ? id : null;
		},
		load(id) {
			if (!id.startsWith(PREFIX)) return null;
			const target = id.slice(PREFIX.length);
			return (
				'import * as m from ' +
				JSON.stringify(target) +
				';\n' +
				'import { serve } from ' +
				JSON.stringify(SERVE) +
				';\n' +
				'serve(m);\n'
			);
		},
		async transform(code, id) {
			if (id.startsWith(PREFIX) || !/\bwith\s*\{\s*run\s*:/.test(code)) return null;
			let out = '';
			let last = 0;
			let header = false;
			for (const m of code.matchAll(RUN_WORKER)) {
				const [whole, list, , spec] = m as unknown as [string, string, string, string];
				const resolved = await this.resolve(spec, id);
				if (resolved === null) this.error('run: worker: cannot resolve ' + spec);
				const ref = this.emitFile({
					type: 'chunk',
					id: PREFIX + resolved.id,
					name: basename(resolved.id).replace(/\.[^.]+$/, '') + '.worker'
				});
				const parts = list
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
					.map((s) => {
						const [name, alias] = s.split(/\s+as\s+/) as [string, string | undefined];
						return { name, alias: alias ?? name };
					});
				const names = JSON.stringify(parts.map((p) => p.name));
				const pattern = parts
					.map((p) => (p.alias === p.name ? p.name : p.name + ': ' + p.alias))
					.join(', ');
				out += code.slice(last, m.index);
				if (!header) {
					out += 'import { threaded as __og_threaded } from ' + JSON.stringify(THREAD) + ';\n';
					header = true;
				}
				out +=
					'const { ' +
					pattern +
					' } = __og_threaded(import.meta.ROLLUP_FILE_URL_' +
					ref +
					', () => import(' +
					JSON.stringify(spec) +
					'), ' +
					names +
					');\n';
				last = m.index + whole.length;
			}
			if (!header) return null;
			return { code: out + code.slice(last), map: null };
		}
	};
}
