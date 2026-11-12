/**
 * ONE COMPILE, IN MEMORY. A `Compiler` on a `memory_fs` (the compiler's file seam), with no Vite:
 * prescan, then each module transformed for both legs in a given order. `snapshot()` is everything
 * the compile decided, as plain sorted data, so two compiles compare with one `toEqual`.
 */
import {
	Compiler,
	CompileCtx,
	Program,
	normalize_import_keys,
	type Fs
} from '../../../packages/compiler/src/compiler/index.ts';
import {
	clientBuildWillSkip,
	csrTrueRouteIds,
	errorCsrTrueRouteIds,
	hasAnyCsrFalseRoute,
	rootLayoutCsrTrue
} from '../../../packages/compiler/src/compiler/kit.ts';
import type { CompileCtxInit } from '../../../packages/compiler/src/compiler/ctx.ts';
import { LIB, ROOT, ROUTES } from './app.ts';

export interface Session {
	readonly compiler: Compiler;
	readonly program: Program;
	readonly ctx: CompileCtx;
	/** each module's transform output, by `<leg> <path>` */
	readonly out: Map<string, string | null>;
}

/** A compile session on `files`. The fields a prescan + transform read; the emit config is unset
 *  (as the compiler's own driver tests do). */
export function session(files: Fs): Session {
	const program = new Program({ forms: true, router: true });
	const compiler = new Compiler(program, {
		prof: {
			transformMs: 0,
			transformN: 0,
			transformHit: 0,
			prescanMs: 0,
			bakeMs: 0,
			bakeN: 0,
			resolveMs: 0,
			loadMs: 0
		},
		P: false,
		outHash: new Map<string, number>()
	});
	const ctx = new CompileCtx({
		root: ROOT,
		base: '/',
		libDir: LIB,
		is_dev: false,
		is_build: true,
		id_salt: '',
		visibleMargin: '0px',
		presets: {},
		import_keys: normalize_import_keys(undefined),
		resolve_alias: [],
		pkg_root: '/nowhere/ogygia',
		app_shims: {},
		fs: files
	} as Partial<CompileCtxInit> as CompileCtxInit);
	compiler.configure(ctx);
	return { compiler, program, ctx, out: new Map() };
}

export type Leg = 'ssr' | 'client';

/** Transform one module for one leg, keeping its output. */
export function transform(s: Session, file: string, leg: Leg): void {
	const src = s.ctx.read_file(file);
	if (src === null) return;
	const r = s.compiler.transform(src, file, { ssr: leg === 'ssr' }) as { code?: string } | null;
	s.out.set(`${leg} ${file}`, r?.code ?? null);
}

/** Every `.svelte` module of the app, sorted: what Vite would transform. */
export function modules(files: Fs): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const e of files.list(dir) ?? []) {
			const p = `${dir}/${e.name}`;
			if (e.kind === 'dir') walk(p);
			else if (e.name.endsWith('.svelte')) out.push(p);
		}
	};
	walk(`${ROOT}/src`);
	return out.sort();
}

const sorted_obj = (m: ReadonlyMap<string, unknown>) =>
	Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** What the compile decided: the registry, the island closure, the region kinds, the runtime
 *  marks, the route worlds, and each transform's output. Sorted, so order alone never differs. */
export function snapshot(s: Session): unknown {
	const r = s.ctx.routes;
	return JSON.parse(
		JSON.stringify(
			{
				registry: sorted_obj(s.program.registry),
				island_graph: [...s.program.island_graph].sort(),
				region_kinds: sorted_obj(s.program.region_kinds),
				// (the marks' lists are sets: features read them with includes/some, link/runtime-entry.ts)
				runtime_marks: Object.fromEntries(
					Object.entries(s.program.runtime_marks).map(([k, v]) => [
						k,
						Array.isArray(v) ? [...v].sort() : v
					])
				),
				transportable: [...s.program.transportable_modules].sort(),
				routes: {
					csr_true: csrTrueRouteIds(r, ROUTES).sort(),
					error_csr_true: errorCsrTrueRouteIds(r, ROUTES).sort(),
					root_layout_csr_true: rootLayoutCsrTrue(r, ROUTES),
					client_build_skips: clientBuildWillSkip(r, ROUTES),
					any_csr_false: hasAnyCsrFalseRoute(r, ROUTES)
				},
				out: sorted_obj(s.out)
			},
			(_k, v) =>
				v instanceof Set
					? [...v].sort()
					: v instanceof Map
						? sorted_obj(v as Map<string, unknown>)
						: v
		)
	);
}
