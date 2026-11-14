// ── ogygia/tests-read-source ──────────────────────────────────────────────
// #1589: a test that imports a package's dist/ cannot fail on a source change until a rebuild, so
// a flip or a mutation of src/ reads green. A test that exists to check the built package is
// listed by name in `.oxlintrc.json` (the rule is off for it there).

import type { Context, Node } from './shared.ts';

const PACKAGE_TEST = /(^|\/)packages\/[^/]+\/test\//;
const THROUGH_DIST = /^\.{1,2}\/(.*\/)?dist(\/|$)/;
const MESSAGE_TEST_READS_DIST =
	'A package test imports dist/: a change to src/ cannot fail it until a rebuild. Import `../src/…ts`; a test that checks the built package is listed in .oxlintrc.json (#1589).';

export const tests_read_source = {
	meta: {
		type: 'problem',
		docs: { description: 'A package test imports the source, not the built dist/.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!PACKAGE_TEST.test(file)) return {};
		const spec_of = (n: Node | undefined): string | undefined => {
			if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
			if (n?.type === 'TemplateLiteral')
				return (n.quasis as Array<{ value: { raw: string } }>).map((q) => q.value.raw).join('');
			return undefined;
		};
		const check = (node: Node, source: Node | undefined) => {
			const spec = spec_of(source);
			if (spec !== undefined && THROUGH_DIST.test(spec))
				context.report({ node, message: MESSAGE_TEST_READS_DIST });
		};
		return {
			ImportDeclaration: (node: Node) => check(node, node.source as Node),
			ExportNamedDeclaration: (node: Node) => check(node, node.source as Node | undefined),
			ExportAllDeclaration: (node: Node) => check(node, node.source as Node),
			ImportExpression: (node: Node) => check(node, node.source as Node),
			NewExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee.type !== 'Identifier' || (callee as { name?: string }).name !== 'URL') return;
				const [spec, base] = node.arguments as Node[];
				const object = base?.type === 'MemberExpression' ? (base.object as Node) : undefined;
				const property = base?.type === 'MemberExpression' ? (base.property as Node) : undefined;
				if (object?.type === 'MetaProperty' && (property as { name?: string })?.name === 'url')
					check(node, spec);
			}
		};
	}
};
