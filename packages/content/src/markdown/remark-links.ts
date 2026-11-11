import type { LinkRef } from '../index.ts';

type MdNode = {
	type?: string;
	url?: string;
	value?: string;
	children?: MdNode[];
	position?: { start?: { line?: number } };
};

/**
 * Collects every markdown link (external, internal, anchors, mailto) onto `file.data.fm.links`,
 * which reaches the entry's `meta.links` for the `links()` check. Markdown `link` nodes only: raw
 * `<a>` html and component `href` props are not seen. A link's `line` counts from after the
 * frontmatter (mdsvex strips it before remark runs).
 */
export function remarkLinks() {
	return (tree: MdNode, file: { data: Record<string, unknown> }): void => {
		const links: LinkRef[] = [];

		const text_of = (node: MdNode): string => {
			if (typeof node.value === 'string') return node.value;
			if (Array.isArray(node.children)) return node.children.map(text_of).join('');
			return '';
		};

		const walk = (node: MdNode) => {
			if (node.type === 'link' && typeof node.url === 'string') {
				const line = node.position?.start?.line;
				links.push({
					href: node.url,
					text: text_of(node).trim(),
					...(typeof line === 'number' ? { line } : {})
				});
			}
			if (Array.isArray(node.children)) node.children.forEach(walk);
		};

		walk(tree);

		const fm = (file.data.fm ??= {}) as Record<string, unknown>;
		fm.links = links;
	};
}
