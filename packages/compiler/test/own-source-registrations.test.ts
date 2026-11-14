// A wire class in the app gets its registration appended; the same class in ogygia's own source does
// not, because an appended `import 'ogygia/…'` inside ogygia would import itself while it evaluates.
import { test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../src/index.ts';
import { partial_ctx_init } from './_compile-ctx.ts';

const WIRE_CLASS = `export class C { static [Symbol.for('ogygia.wire')] = { encode: (c) => c.v, decode: (v) => new C(v) }; }\n`;

let root = '';
let pkg_root = '';

function make_compiler() {
	const program = new Program({ forms: true, router: true });
	const profiler = {
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
	};
	return new Compiler(
		program,
		profiler,
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				libDir: path.join(root, 'src/lib'),
				is_dev: false,
				is_build: true,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root,
				app_shims: {}
			})
		)
	);
}

async function transform(id: string) {
	const compiler = make_compiler();
	compiler.start_leg('client', false);
	return compiler.transform_module(WIRE_CLASS, id, {
		leg: compiler.leg({ name: 'client', server: false }),
		emitFile: () => 'ref'
	});
}

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-own-'));
	pkg_root = path.join(root, 'linked-ogygia');
	fs.mkdirSync(path.join(root, 'src/lib'), { recursive: true });
	fs.mkdirSync(path.join(pkg_root, 'src'), { recursive: true });
	fs.writeFileSync(path.join(root, 'src/lib/c.ts'), WIRE_CLASS);
	fs.writeFileSync(path.join(pkg_root, 'src/c.ts'), WIRE_CLASS);
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

test("an app wire class gets its registration; the same class in ogygia's own source does not", async () => {
	const app = await transform(path.join(root, 'src/lib/c.ts'));
	expect(app?.code).toContain('__OGT(');
	const own = await transform(path.join(pkg_root, 'src/c.ts'));
	expect(own?.code ?? WIRE_CLASS).not.toContain('__OGT(');
});
