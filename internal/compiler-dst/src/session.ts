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
} from '../../../packages/compiler/src/index.ts';
import {
	clientBuildWillSkip,
	csrTrueRouteIds,
	errorCsrTrueRouteIds,
	hasAnyCsrFalseRoute,
	rootLayoutCsrTrue
} from '../../../packages/compiler/src/kit.ts';
import type { PageReadsSink } from '../../../packages/compiler/src/ctx.ts';
import { LIB, PAGE_FILES, ROOT, ROUTES } from './app.ts';

export interface Session {
	readonly compiler: Compiler;
	readonly program: Program;
	readonly ctx: CompileCtx;
	/** each module's transform output, by `<leg> <path>` */
	readonly out: Map<string, unknown>;
	/** the chunks the transforms emitted (a build's island entries), in emit order */
	readonly emitted: string[];
}

/** How a session runs: a build (the default), or a dev server. */
export interface SessionOptions {
	readonly dev?: boolean;
	/** The seed-shaping plugin's answers (`dataShake()`), when the app lists it. */
	readonly page_reads?: PageReadsSink | null;
}

/** A compile session on `files`. The fields a prescan + transform read, and an emit config with
 *  fixed stand-ins (no secret, no Kit paths on disk), so the virtual modules load too. */
export function session(
	files: Fs,
	{ dev = false, page_reads = null }: SessionOptions = {}
): Session {
	const program = new Program({ forms: true, router: true });
	const ctx = new CompileCtx({
		root: ROOT,
		base: '/',
		app_dir: '_app',
		libDir: LIB,
		measure: false,
		is_dev: dev,
		is_build: !dev,
		id_salt: '',
		visibleMargin: '0px',
		presets: {},
		import_keys: normalize_import_keys(undefined),
		resolve_alias: [],
		pkg_root: '/nowhere/ogygia',
		build_secret: 'dst-secret',
		rate_limit: { max: 0, windowMs: 0 },
		session_cookie: '',
		region_ttl: 3600,
		renew_window: 0,
		router_enabled: true,
		router_view_transitions: false,
		runtime_dir: '/nowhere/ogygia/runtime',
		runtime_hash: 'dst',
		client_binding_stub_file: '/nowhere/ogygia/client-binding-stub.js',
		app_shims: {},
		devtools: false,
		fs: files,
		page_reads,
		page_files: PAGE_FILES
	});
	const compiler = new Compiler(
		program,
		{
			prof: {
				transformMs: 0,
				transformN: 0,
				transformHit: 0,
				prescanMs: 0,
				macroMs: 0,
				macroN: 0,
				resolveMs: 0,
				loadMs: 0
			},
			P: false,
			outHash: new Map<string, number>()
		},
		ctx
	);
	if (!dev) {
		compiler.start_leg('ssr', true);
		compiler.start_leg('client', false);
	}
	return { compiler, program, ctx, out: new Map(), emitted: [] };
}

export type Leg = 'ssr' | 'client';

/** Transform one module for one leg, as the plugin's transform hook does (macros, the host
 *  transform, registration, ts regions, the `$app/*` shim). An emitted chunk is named by its id. */
export async function transform_module(
	s: Session,
	file: string,
	leg: Leg,
	code: string | null = s.ctx.read_file(file)
): Promise<string | null | { throws: string }> {
	const src = code;
	if (src === null) return null;
	try {
		const r = await s.compiler.transform_module(src, file, {
			leg: s.compiler.leg(
				leg === 'ssr' ? { name: 'ssr', server: true } : { name: 'client', server: false }
			),
			emitFile: (chunk) => {
				s.emitted.push(`${chunk.name} ${chunk.id}`);
				return chunk.id;
			}
		});
		return r?.code ?? null;
	} catch (e) {
		return { throws: code_of(e) };
	}
}

export const code_of = (e: unknown): string =>
	(e as { code?: string })?.code ?? (e instanceof Error ? e.message : String(e));

/** Transform one module for one leg, keeping its output. */
export async function transform(s: Session, file: string, leg: Leg): Promise<void> {
	if (s.ctx.read_file(file) === null) return;
	s.out.set(`${leg} ${file}`, await transform_module(s, file, leg));
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

const by_string = (a: unknown, b: unknown) => {
	const x = String(a);
	const y = String(b);
	return x < y ? -1 : x > y ? 1 : 0;
};

/** What the compile decided: the registry, the island closure, the region kinds, the runtime
 *  marks, the route worlds, and each transform's output. Sorted, so order alone never differs. */
export function snapshot(s: Session, out: ReadonlyMap<string, unknown> = s.out): unknown {
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
				emitted: [...s.emitted].sort(),
				// (as the driver gives them, unsorted: a build reads them in this order, so it must not
				// follow the order the files were listed or transformed in; a driver that stopped
				// sorting them survived)
				lists: {
					island_scan_entries: s.compiler.island_scan_entries(),
					router_css_roots: s.compiler.router_css_roots(),
					server_island_css_roots: s.compiler.server_island_css_roots(),
					ssr_transformed_hosts: s.compiler.ssr_transformed_hosts()
				},
				out: sorted_obj(out)
			},
			(_k, v) =>
				v instanceof Set
					? [...v].sort(by_string)
					: v instanceof Map
						? sorted_obj(v as Map<string, unknown>)
						: v
		)
	);
}
