// ── ogygia/compiler-boundary ──────────────────────────────────────────────
// `@ogygia/compiler` uses core only through `@ogygia/core/contract` (what both share, and core's
// own files by path); core never uses the compiler. Package source only: tests may reach across.

import type { Context, Node } from './shared.ts';

const PACKAGE_SRC = /(^|\/)packages\/(core|compiler)\/src\//;
/** Core, by either name: `@ogygia/core`, `ogygia`, or a subpath. */
const CORE_SPEC = /^(@ogygia\/core|ogygia)(\/|$)/;
/** The compiler: its package, or the `ogygia` subpaths that re-export it. */
const COMPILER_SPEC = /^(@ogygia\/compiler(\/|$)|ogygia\/(vite|internal\/compiler(-ids)?)$)/;
const COMPILER_MAY_USE = '@ogygia/core/contract';
const MESSAGE_CORE_USES_COMPILER =
	'Core imports the compiler. Move what both need into core’s contract/ (#488, #513).';
const MESSAGE_COMPILER_USES_CORE =
	'The compiler imports core outside `@ogygia/core/contract`. Move what both need into core’s contract/ (#488, #513).';
const MESSAGE_LEAVES_PACKAGE =
	'A relative import leaves its package. Import the other package by name (#513).';

/** Whether relative `spec` from `file` (inside `packages/<pkg>/src/`) leaves `packages/<pkg>/`. */
function leaves_package(file: string, pkg: string, spec: string): boolean {
	if (!spec.startsWith('.')) return false;
	const parts = file.slice(0, file.lastIndexOf('/')).split('/');
	for (const seg of spec.split('/')) {
		if (seg === '.' || seg === '') continue;
		if (seg === '..') parts.pop();
		else parts.push(seg);
	}
	return !`${parts.join('/')}/`.includes(`/packages/${pkg}/`);
}

export const compiler_boundary = {
	meta: {
		type: 'problem',
		docs: { description: 'The compiler uses core only through its contract; core never uses it.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		const m = PACKAGE_SRC.exec(file);
		if (!m) return {};
		const pkg = m[2];
		const check = (node: Node, source: unknown) => {
			const value = (source as { value?: unknown } | null)?.value;
			if (typeof value !== 'string') return;
			if (leaves_package(file, pkg, value))
				context.report({ node, message: MESSAGE_LEAVES_PACKAGE });
			else if (pkg === 'core' && COMPILER_SPEC.test(value))
				context.report({ node, message: MESSAGE_CORE_USES_COMPILER });
			else if (pkg === 'compiler' && CORE_SPEC.test(value) && value !== COMPILER_MAY_USE)
				context.report({ node, message: MESSAGE_COMPILER_USES_CORE });
		};
		return {
			ImportDeclaration: (node: Node) => check(node, node.source),
			ExportNamedDeclaration: (node: Node) => check(node, node.source),
			ExportAllDeclaration: (node: Node) => check(node, node.source),
			ImportExpression: (node: Node) => check(node, node.source),
			TSImportType: (node: Node) => {
				const arg = node.argument as Node | undefined;
				check(node, (arg as { literal?: unknown } | undefined)?.literal ?? arg);
			}
		};
	}
};
