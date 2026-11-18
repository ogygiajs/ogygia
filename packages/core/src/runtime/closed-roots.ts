let closed: WeakSet<Element> | null = null;

const CLOSED_MARKUP = /shadowrootmode\s*=\s*["']?closed/i;

/** True when `html` may declare a closed shadow root: only then is it worth a second parse. */
export function may_declare_closed_root(html: string): boolean {
	return CLOSED_MARKUP.test(html);
}

/** Notes each host under `parsed` whose declarative shadow root is closed and not clonable, read
 *  off `inert`: the same HTML, parsed with no declarative shadow roots attached. A walk that meets
 *  two trees it cannot pair stops there, so a host is only ever noted when the markup declared its
 *  closed root. */
export function note_closed_roots(inert: ParentNode, parsed: ParentNode): void {
	const consumed = dsd_count(inert) > dsd_count(parsed) ? first_dsd(inert) : null;
	if (consumed) {
		if (!is_element(parsed)) return;
		const open = consumed.getAttribute('shadowrootmode') === 'open';
		if (open) {
			if (!parsed.shadowRoot) return;
			note_closed_roots(consumed.content, parsed.shadowRoot);
		} else {
			if (parsed.shadowRoot) return;
			if (!consumed.hasAttribute('shadowrootclonable')) (closed ??= new WeakSet()).add(parsed);
		}
	}
	let real = parsed.firstElementChild;
	for (let el = inert.firstElementChild; el; el = el.nextElementSibling) {
		if (el === consumed) continue;
		if (!real || real.localName !== el.localName) return;
		note_closed_roots(el, real);
		real = real.nextElementSibling;
	}
}

/** True when `host` is one {@link note_closed_roots} noted: a copy of it has lost its root. */
export function closed_root_lost(host: Element): boolean {
	return closed !== null && closed.has(host);
}

function is_dsd(el: Element): el is HTMLTemplateElement {
	return el.localName === 'template' && el.hasAttribute('shadowrootmode');
}

function first_dsd(under: ParentNode): HTMLTemplateElement | null {
	for (let el = under.firstElementChild; el; el = el.nextElementSibling) if (is_dsd(el)) return el;
	return null;
}

function dsd_count(under: ParentNode): number {
	let n = 0;
	for (let el = under.firstElementChild; el; el = el.nextElementSibling) if (is_dsd(el)) n++;
	return n;
}

function is_element(node: ParentNode): node is Element {
	return (node as Node).nodeType === 1;
}
