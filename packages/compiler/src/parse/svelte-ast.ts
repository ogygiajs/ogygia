/**
 * Every node of Svelte's modern template AST (`parse(…, { modern: true })`) ogygia's code reads, with
 * the fields it reads on it. test/canary/svelte-ast.test.ts parses a fixture that holds every one
 * with the installed Svelte and checks each node has its fields; it also fails when a file that walks
 * the AST names a node type this table lacks, so a new read comes with its canary (#1722).
 */
export const SVELTE_AST_READS: Readonly<Record<string, readonly string[]>> = {
	Root: ['fragment', 'instance', 'module', 'css'],
	Script: ['content', 'context'],
	Fragment: ['nodes'],
	Text: ['data', 'raw'],
	Comment: ['data'],
	ExpressionTag: ['expression'],
	HtmlTag: ['expression'],
	ConstTag: ['declaration'],
	DebugTag: ['identifiers'],
	RenderTag: ['expression'],
	AttachTag: ['expression'],
	RegularElement: ['name', 'attributes', 'fragment'],
	TitleElement: ['name', 'attributes', 'fragment'],
	SlotElement: ['name', 'attributes', 'fragment'],
	Component: ['name', 'attributes', 'fragment'],
	SvelteComponent: ['expression', 'attributes', 'fragment'],
	SvelteElement: ['tag', 'attributes', 'fragment'],
	SvelteSelf: ['attributes', 'fragment'],
	SvelteFragment: ['attributes', 'fragment'],
	SvelteBoundary: ['attributes', 'fragment'],
	SvelteHead: ['fragment'],
	SvelteBody: ['attributes'],
	SvelteDocument: ['attributes'],
	SvelteWindow: ['attributes'],
	IfBlock: ['test', 'consequent', 'alternate'],
	EachBlock: ['expression', 'context', 'index', 'key', 'body', 'fallback'],
	AwaitBlock: ['expression', 'value', 'error', 'pending', 'then', 'catch'],
	KeyBlock: ['expression', 'fragment'],
	SnippetBlock: ['expression', 'parameters', 'body'],
	Attribute: ['name', 'value'],
	SpreadAttribute: ['expression'],
	BindDirective: ['name', 'expression'],
	OnDirective: ['name', 'expression'],
	UseDirective: ['name', 'expression'],
	TransitionDirective: ['name', 'expression'],
	AnimateDirective: ['name', 'expression'],
	StyleDirective: ['name', 'value'],
	LetDirective: ['name', 'expression']
};
