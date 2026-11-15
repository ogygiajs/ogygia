/**
 * THE RESTORE LAB's server transform (e2e/restore.spec.ts, `OGYGIA_RESTORE_LAB=1`): a stand-in for a
 * web-component server render in "scoped" form, reduced to what such a render does to markup.
 *
 * - `<demo-card>`: its tree goes into the host's light DOM and the host's children move into a
 *   `<slot>` wrapper inside it; like a real serializer it drops whitespace-only text and trims the
 *   rest to one space, and it stamps attributes on the children (`c-id`) and the host.
 * - `<demo-link>`: its tree is an `<a>` — inside the page's own link, the HTML parser would split it.
 *
 * On a host ogygia marks `og-h` it writes the plan (`og-shadow`, `og-keep`) and the keyed shadow sheet
 * once. Regex is fine here: a lab, not a hot path.
 */
const SHEETS: Record<string, string> = {
	'demo-card.shadow':
		':host{display:block;border:2px solid #0a7;padding:8px}b.title{display:block;color:rgb(0, 119, 85)}',
	'demo-link.shadow': ':host{display:inline}a{text-decoration:underline}',
	'demo-nav.shadow': ':host{display:block}nav{display:flex;gap:8px}'
};

function scoped_parts(html: string): { html: string; used: Set<string> } {
	const used = new Set<string>();
	let out = render(html, 'demo-card', used, (inner) => {
		const trimmed = inner
			.replace(/>\s+</g, '><')
			.replace(/>\s+([^<\s])/g, '> $1')
			.replace(/([^>\s])\s+</g, '$1 <');
		const stamped = trimmed.replace(/(<[a-z][\w-]*)( og-c=")/g, '$1 c-id="0.1"$2');
		return `<div class="card sc-demo-card"><b class="title sc-demo-card">Card title</b><slot class="sc-demo-card sc-demo-card-s">${stamped}</slot></div><!--o.0.1-->`;
	});
	out = render(
		out,
		'demo-link',
		used,
		(inner) =>
			`<a class="link sc-demo-link" aria-hidden="true" tabindex="-1" href="#"><slot class="sc-demo-link sc-demo-link-s">${inner}</slot></a>`
	);
	// a nav whose own client hydrate unpacks this tree (restore-lab/nav-a: the shadow tree, then the
	// original children back in the light DOM — what a scoped component runtime does on first load)
	out = render(
		out,
		'demo-nav',
		used,
		(inner) =>
			`<nav class="web sc-demo-nav" c-id="9.0"><b class="sc-demo-nav" c-id="9.1">menu</b><slot class="sc-demo-nav sc-demo-nav-s">${inner}</slot></nav>`
	);
	return { html: out, used };
}

/** The lab's render of one element, as a rewrite returns it: its HTML and the sheets it names. */
export function scoped_element(html: string): {
	html: string;
	sheets: { key: string; css: string; scope: 'shadow' }[];
} {
	const r = scoped_parts(html);
	return {
		html: r.html,
		sheets: [...r.used].map((key) => ({ key, css: SHEETS[key], scope: 'shadow' }))
	};
}

function render(
	html: string,
	tag: string,
	used: Set<string>,
	tree: (inner: string) => string
): string {
	const out: string[] = [];
	let at = 0;
	for (;;) {
		const open = html.indexOf(`<${tag}`, at);
		const gt = open === -1 ? -1 : html.indexOf('>', open);
		const close = open === -1 ? -1 : html.indexOf(`</${tag}>`, gt);
		if (close === -1) {
			out.push(html.slice(at));
			return out.join('');
		}
		const attrs = html.slice(open + tag.length + 1, gt);
		const planned = / og-h="/.test(attrs);
		if (planned) used.add(`${tag}.shadow`);
		const marked = planned ? `${attrs} og-shadow="${tag}.shadow" og-keep="data-rendered"` : attrs;
		const classed = /\sclass="/.test(marked)
			? marked.replace(/\sclass="([^"]*)"/, ` class="$1 sc-${tag}-h"`)
			: `${marked} class="sc-${tag}-h"`;
		out.push(
			html.slice(at, open),
			`<${tag}${classed} data-rendered="">${tree(html.slice(gt + 1, close))}</${tag}>`
		);
		at = close + tag.length + 3;
	}
}
