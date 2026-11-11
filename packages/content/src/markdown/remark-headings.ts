import type { Heading } from '../index.ts';

const SLUG_STRIP_NON_ALNUM = /[^\p{L}\p{N} \-_]/gu;
const SLUG_WS_UNDER = /[\s_]+/g;
const SLUG_MULTI_DASH = /-+/g;
const SLUG_EDGE_DASH = /^-|-$/g;
const ENTITY_HEX_G = /&#x([0-9a-f]+);/gi;
const ENTITY_DEC_G = /&#(\d+);/g;
const ENTITY_LT_G = /&lt;/g;
const ENTITY_GT_G = /&gt;/g;
const ENTITY_QUOT_G = /&quot;/g;
const ENTITY_APOS_G = /&#39;|&apos;/g;
const ENTITY_AMP_G = /&amp;/g;

type MdNode = {
	type?: string;
	depth?: number;
	value?: string;
	children?: MdNode[];
	data?: { hProperties?: Record<string, string> } & Record<string, unknown>;
};

/** GitHub-ish slug: lowercase, strip punctuation, spaces → dashes. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(SLUG_STRIP_NON_ALNUM, '')
		.replace(SLUG_WS_UNDER, '-')
		.replace(SLUG_MULTI_DASH, '-')
		.replace(SLUG_EDGE_DASH, '');
}

export type RemarkHeadingsOptions = {
	/** Shallowest depth to collect (default 2). */
	minDepth?: 2 | 3 | 4;
	/** Deepest depth to collect (default 4). */
	maxDepth?: 2 | 3 | 4;
};

type Frame = { depth: number; id: string };

/**
 * Collect `h2`–`h4` (`minDepth`–`maxDepth`) into `metadata.headings`, and give every heading
 * without an explicit `{#id}` an id. Runs after `remark-heading-id`, so an explicit id wins.
 *
 * An auto id is scoped: it joins the ids of the open ancestor headings with its own slug. For
 * `# A / ## B / ### C / ## D` the ids are `a`, `a-b`, `a-b-c`, `a-d`. An explicit `{#id}` stays
 * as written, reserves itself (a later heading that slugs to it gets a suffix), and is the scope
 * its descendants nest under. Every depth gets an id, so the ancestor path is complete; only the
 * collected depths reach `metadata.headings`.
 */
export function remarkHeadings(options: RemarkHeadingsOptions = {}) {
	const min = options.minDepth ?? 2;
	const max = options.maxDepth ?? 4;

	return (tree: MdNode, file: { data: Record<string, unknown> }): void => {
		const headings: Heading[] = [];
		const seen = new Map<string, number>();
		const stack: Frame[] = [];

		const decodeEntities = (s: string): string =>
			s
				.replace(ENTITY_HEX_G, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
				.replace(ENTITY_DEC_G, (_, dec) => String.fromCodePoint(Number(dec)))
				.replace(ENTITY_LT_G, '<')
				.replace(ENTITY_GT_G, '>')
				.replace(ENTITY_QUOT_G, '"')
				.replace(ENTITY_APOS_G, "'")
				.replace(ENTITY_AMP_G, '&');

		const textOf = (node: MdNode): string => {
			if (typeof node.value === 'string') return node.value;
			if (Array.isArray(node.children)) return node.children.map(textOf).join('');
			return '';
		};

		const walk = (node: MdNode) => {
			if (node.type === 'heading' && typeof node.depth === 'number') {
				const depth = node.depth;
				// @why mdsvex entity-encodes `{` and `}` before this plugin runs: inline-code heading text arrives as `&#123;` (test: test/markdown.test.ts › a heading with inline code shows its braces in metadata.headings, not entities)
				const text = decodeEntities(textOf(node)).trim();
				const data = (node.data ??= {});
				const props = (data.hProperties ??= {});

				while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
				const parent = stack.length ? stack[stack.length - 1].id : null;

				let id: string;
				if (props.id) {
					id = props.id;
					seen.set(id, (seen.get(id) ?? 0) + 1);
				} else {
					const ownSlug = slugify(text) || 'section';
					const base = parent ? `${parent}-${ownSlug}` : ownSlug;
					const n = seen.get(base) ?? 0;
					seen.set(base, n + 1);
					id = n ? `${base}-${n}` : base;
					props.id = id;
				}

				stack.push({ depth, id });

				if (depth >= min && depth <= max) {
					headings.push({ depth: depth as 2 | 3 | 4, id, text });
				}
			}
			if (Array.isArray(node.children)) node.children.forEach(walk);
		};

		walk(tree);

		const fm = (file.data.fm ??= {}) as Record<string, unknown>;
		fm.headings = headings;
	};
}
