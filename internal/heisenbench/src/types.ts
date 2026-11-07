/**
 * Types for the bench files: `node internal/heisenbench/src/types.ts` (or `pnpm bench:types`).
 *
 * A bench file reaches a module's private functions through the `__heisenbench` export the bench
 * transform appends to every module (`import { __heisenbench } from '../src/router/match.ts'`). TypeScript
 * cannot see that export, so this writes it down: for each package with bench files, Heisenbench's `dts`
 * command types the `__heisenbench` of every module those files import it from, into
 * `packages/<pkg>/bench/__heisenbench.d.ts` (gitignored, rewritten on every run). It also links
 * `node_modules/@bench/heisenbench` (see heisenbench.ts), which bench files import their API from.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { heisenbench_dir, bench_packages, link_heisenbench, REPO_ROOT } from './heisenbench.ts';

interface ImportEntry {
	importName: { name: string | null };
}

interface StaticImport {
	moduleRequest: { value: string };
	entries: ImportEntry[];
}

interface Parser {
	parseSync(
		file: string,
		code: string,
		options?: object
	): { module: { staticImports: StaticImport[] } };
}

/** The modules `file` imports `__heisenbench` from (relative specifiers only), as absolute paths. */
function heisenbench_sources(parser: Parser, file: string): string[] {
	const { module } = parser.parseSync(file, readFileSync(file, 'utf8'), { sourceType: 'module' });
	const out: string[] = [];
	for (const s of module.staticImports) {
		const spec = s.moduleRequest.value;
		if (!spec.startsWith('.')) continue;
		if (s.entries.some((e) => e.importName.name === '__heisenbench'))
			out.push(resolve(dirname(file), spec));
	}
	return out;
}

function write_types(): void {
	const heisenbench = heisenbench_dir();
	link_heisenbench(heisenbench);
	const parser = createRequire(join(heisenbench, 'package.json'))('oxc-parser') as Parser;
	const cli = join(heisenbench, 'src', 'cli.ts');
	for (const pkg of bench_packages()) {
		const sources = [...new Set(pkg.files.flatMap((f) => heisenbench_sources(parser, f)))].sort();
		const out = join(pkg.dir, 'bench', '__heisenbench.d.ts');
		if (sources.length === 0) continue;
		execFileSync(process.execPath, [cli, 'dts', ...sources, '--out', out], {
			cwd: REPO_ROOT,
			stdio: 'inherit'
		});
		console.log(
			`${relative(REPO_ROOT, out)}: __heisenbench of ${sources.length} module${sources.length === 1 ? '' : 's'}`
		);
	}
}

write_types();
