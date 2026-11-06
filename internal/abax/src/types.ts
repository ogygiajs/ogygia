/**
 * Types for the bench files: `node internal/abax/src/types.ts` (or `pnpm bench:types`).
 *
 * A bench file reaches a module's private functions through the `__abax` export the bench
 * transform appends to every module (`import { __abax } from '../src/router/match.ts'`). TypeScript
 * cannot see that export, so this writes it down: for each package with bench files, Abax's `dts`
 * command types the `__abax` of every module those files import it from, into
 * `packages/<pkg>/bench/__abax.d.ts` (gitignored, rewritten on every run). It also links
 * `node_modules/@bench/abax` (see abax.ts), which bench files import their API from.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { abax_dir, bench_packages, link_abax, REPO_ROOT } from './abax.ts';

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

/** The modules `file` imports `__abax` from (relative specifiers only), as absolute paths. */
function abax_sources(parser: Parser, file: string): string[] {
	const { module } = parser.parseSync(file, readFileSync(file, 'utf8'), { sourceType: 'module' });
	const out: string[] = [];
	for (const s of module.staticImports) {
		const spec = s.moduleRequest.value;
		if (!spec.startsWith('.')) continue;
		if (s.entries.some((e) => e.importName.name === '__abax'))
			out.push(resolve(dirname(file), spec));
	}
	return out;
}

function write_types(): void {
	const abax = abax_dir();
	link_abax(abax);
	const parser = createRequire(join(abax, 'package.json'))('oxc-parser') as Parser;
	const cli = join(abax, 'src', 'cli.ts');
	for (const pkg of bench_packages()) {
		const sources = [...new Set(pkg.files.flatMap((f) => abax_sources(parser, f)))].sort();
		const out = join(pkg.dir, 'bench', '__abax.d.ts');
		if (sources.length === 0) continue;
		execFileSync(process.execPath, [cli, 'dts', ...sources, '--out', out], {
			cwd: REPO_ROOT,
			stdio: 'inherit'
		});
		console.log(
			`${relative(REPO_ROOT, out)}: __abax of ${sources.length} module${sources.length === 1 ? '' : 's'}`
		);
	}
}

write_types();
