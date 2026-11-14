/**
 * Tiny, faithful DOM shim for the morph unit tests (and the bench files that run DOM code in Node:
 * bench/runtime.bench.ts, bench/hydrate.bench.ts).
 *
 * The ogygia repo runs vitest in the `node` environment on purpose (no jsdom/happy-dom dependency),
 * so there is no real DOM. `morph.ts` is pure DOM manipulation, so to unit-test it we stand up just
 * enough of the DOM: a doubly-linked child list, elements with attributes + namespaces, text/comment
 * nodes, `importNode`, `activeElement`/`focus`, and dirty-value/checked/selected form properties that
 * mirror the browser's "property vs attribute" split. The document has a `<head>` and a `<body>`,
 * an id map (`getElementById`) and the few selectors the runtime asks of it. A MutationObserver
 * (child lists and text, with subtree), so the runtime's observer paths run as in a browser.
 *
 * Importing this module INSTALLS `globalThis.Node`, `globalThis.document` and
 * `globalThis.MutationObserver` as a side effect, so it
 * MUST be imported before `morph.ts` (which reads `Node.ELEMENT_NODE` at module load).
 */

const NS_HTML = 'http://www.w3.org/1999/xhtml';
const NS_SVG = 'http://www.w3.org/2000/svg';

const VOID = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr'
]);
const FORMISH = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

type Attr = { name: string; value: string };

class DomNode {
	static readonly ELEMENT_NODE = 1;
	static readonly TEXT_NODE = 3;
	static readonly COMMENT_NODE = 8;
	static readonly DOCUMENT_FRAGMENT_NODE = 11;

	readonly ELEMENT_NODE = 1;
	readonly TEXT_NODE = 3;
	readonly COMMENT_NODE = 8;

	nodeType = 0;
	nodeValue: string | null = null;
	ownerDocument: DomDocument;

	_parent: DomNode | null = null;
	_prev: DomNode | null = null;
	_next: DomNode | null = null;
	_first: DomNode | null = null;
	_last: DomNode | null = null;
	/** the mutation observers registered on this node (see DomMutationObserver) */
	_observers: DomMutationObserver[] | null = null;

	constructor(doc: DomDocument | null) {
		// The document itself passes null and patches ownerDocument to itself.
		this.ownerDocument = doc as DomDocument;
	}

	get parentNode(): DomNode | null {
		return this._parent;
	}
	/** The parent when it is an element (not the document / a fragment), else null — DOM `parentElement`. */
	get parentElement(): DomNode | null {
		const p = this._parent;
		return p && p.nodeType === 1 ? p : null;
	}
	/** DOM `contains`: self-inclusive ancestor test (walks the `_parent` chain). */
	contains(other: DomNode | null): boolean {
		for (let n: DomNode | null = other; n; n = n._parent) if (n === this) return true;
		return false;
	}
	get firstChild(): DomNode | null {
		return this._first;
	}
	get lastChild(): DomNode | null {
		return this._last;
	}
	get nextSibling(): DomNode | null {
		return this._next;
	}
	get previousSibling(): DomNode | null {
		return this._prev;
	}
	get nextElementSibling(): DomNode | null {
		for (let n = this._next; n; n = n._next) if (n.nodeType === 1) return n;
		return null;
	}
	/** DOM `compareDocumentPosition`: following (4) / preceding (2), with contains (8) and
	 *  contained-by (16) for an ancestor or a descendant; another tree is disconnected (1). */
	compareDocumentPosition(other: DomNode): number {
		if (other === this) return 0;
		const chain = (n: DomNode) => {
			const out: DomNode[] = [];
			for (let x: DomNode | null = n; x; x = x._parent) out.unshift(x);
			return out;
		};
		const a = chain(this);
		const b = chain(other);
		if (a[0] !== b[0]) return 1;
		let i = 0;
		while (i < a.length && i < b.length && a[i] === b[i]) i++;
		if (i === a.length) return 16 | 4;
		if (i === b.length) return 8 | 2;
		for (let n: DomNode | null = a[i]; n; n = n._next) if (n === b[i]) return 4;
		return 2;
	}
	/** The top of this node's tree: the document when it is in it, else the detached root. */
	getRootNode(): DomNode {
		return this._parent ? this._parent.getRootNode() : this;
	}
	get isConnected(): boolean {
		return this.getRootNode().nodeType === 9;
	}
	remove(): void {
		if (this._parent) this._parent._detach(this);
	}

	/** Minimal selectors: a comma list of `tag`, `[attr]`, `tag[attr]`, `tag[attr="value"]`. */
	querySelectorAll(selector: string): DomElement[] {
		return select(this, selector, false);
	}
	querySelector(selector: string): DomElement | null {
		return select(this, selector, true)[0] ?? null;
	}
	getElementsByTagName(tag: string): DomElement[] {
		return select(this, tag, false);
	}

	// Events: listeners per type, at the target and (when the event bubbles) its ancestors.
	_listeners: Map<string, Array<(e: Event) => void>> | null = null;
	addEventListener(type: string, fn: (e: Event) => void): void {
		const map = (this._listeners ??= new Map());
		const list = map.get(type);
		if (!list) map.set(type, [fn]);
		else if (!list.includes(fn)) list.push(fn);
	}
	removeEventListener(type: string, fn: (e: Event) => void): void {
		const list = this._listeners?.get(type);
		const i = list ? list.indexOf(fn) : -1;
		if (i >= 0) list!.splice(i, 1);
	}
	dispatchEvent(e: Event): boolean {
		Object.defineProperty(e, 'target', { value: this, configurable: true });
		dispatch_at(this, e);
		return !e.defaultPrevented;
	}

	get childNodes(): DomNode[] {
		const out: DomNode[] = [];
		for (let n = this._first; n; n = n._next) out.push(n);
		return out;
	}

	_detach(node: DomNode): void {
		const prev = node._prev;
		const next = node._next;
		if (observing > 0) notify(this, 'childList', [], [node], prev, next);
		if (prev) prev._next = next;
		else this._first = next;
		if (next) next._prev = prev;
		else this._last = prev;
		node._parent = node._prev = node._next = null;
	}

	insertBefore(node: DomNode, ref: DomNode | null): DomNode {
		// a fragment inserts its children, and is left empty
		if (node.nodeType === 11) {
			while (node._first) this.insertBefore(node._first, ref);
			return node;
		}
		if (node._parent) node._parent._detach(node);
		const prev = ref ? ref._prev : this._last;
		node._parent = this;
		node._prev = prev;
		node._next = ref;
		if (prev) prev._next = node;
		else this._first = node;
		if (ref) ref._prev = node;
		else this._last = node;
		if (observing > 0) notify(this, 'childList', [node], [], prev, ref);
		return node;
	}

	appendChild(node: DomNode): DomNode {
		return this.insertBefore(node, null);
	}
	replaceChildren(...nodes: DomNode[]): void {
		while (this._first) this._detach(this._first);
		for (const n of nodes) this.appendChild(n);
	}
	removeChild(node: DomNode): DomNode {
		this._detach(node);
		return node;
	}

	replaceChild(next: DomNode, old: DomNode): DomNode {
		this.insertBefore(next, old);
		this._detach(old);
		return old;
	}

	replaceWith(next: DomNode): void {
		if (this._parent) this._parent.replaceChild(next, this);
	}

	get textContent(): string {
		if (this.nodeType !== 1) return this.nodeValue ?? '';
		let s = '';
		for (let n = this._first; n; n = n._next) s += n.textContent;
		return s;
	}
	set textContent(v: string) {
		while (this._first) this._detach(this._first);
		if (v !== '') this.appendChild(this.ownerDocument.createTextNode(v));
	}

	cloneNode(_deep?: boolean): DomNode {
		throw new Error('abstract');
	}
}

class DomText extends DomNode {
	constructor(doc: DomDocument, data: string, type = 3) {
		super(doc);
		this.nodeType = type;
		this.nodeValue = data;
	}
	/** CharacterData `data`: a text or comment node's text. */
	get data(): string {
		return this.nodeValue ?? '';
	}
	set data(v: string) {
		this.nodeValue = v;
		if (observing > 0) notify(this, 'characterData', [], [], null, null);
	}
	cloneNode(): DomNode {
		return new DomText(this.ownerDocument, this.nodeValue ?? '', this.nodeType);
	}
}

class DomElement extends DomNode {
	namespaceURI: string;
	localName: string;
	tagName: string;
	_attrs: Attr[] = [];

	// Dirty form state — mirrors the browser's property-vs-attribute split.
	_value: string | null = null;
	_checked: boolean | null = null;
	_selected: boolean | null = null;

	constructor(doc: DomDocument, ns: string, localName: string, tagName: string) {
		super(doc);
		this.nodeType = 1;
		this.namespaceURI = ns;
		this.localName = localName;
		this.tagName = tagName;
	}

	get attributes(): Attr[] {
		return this._attrs;
	}

	// (plain loops: a bench counts the shim's work too, and a browser's lookup is native)
	getAttribute(name: string): string | null {
		for (const a of this._attrs) if (a.name === name) return a.value;
		return null;
	}
	hasAttribute(name: string): boolean {
		for (const a of this._attrs) if (a.name === name) return true;
		return false;
	}
	setAttribute(name: string, value: string): void {
		const a = this._attrs.find((x) => x.name === name);
		if (a) a.value = String(value);
		else this._attrs.push({ name, value: String(value) });
		// the document's id map (getElementById), as a browser keeps one
		if (name === 'id') this.ownerDocument._ids.set(String(value), this);
	}
	removeAttribute(name: string): void {
		const i = this._attrs.findIndex((x) => x.name === name);
		if (i >= 0) this._attrs.splice(i, 1);
	}

	get id(): string {
		return this.getAttribute('id') ?? '';
	}

	get children(): DomElement[] {
		const out: DomElement[] = [];
		for (let n = this._first; n; n = n._next) if (n.nodeType === 1) out.push(n as DomElement);
		return out;
	}
	get firstElementChild(): DomElement | null {
		for (let n = this._first; n; n = n._next) if (n.nodeType === 1) return n as DomElement;
		return null;
	}

	// --- form properties (only meaningful on form controls) ---
	get value(): string {
		if (this._value !== null) return this._value;
		if (this.tagName === 'OPTION') return this.getAttribute('value') ?? this.textContent;
		if (this.tagName === 'SELECT') {
			for (const opt of this.querySelectorOptions()) if (opt.selected) return opt.value;
			const first = this.querySelectorOptions()[0];
			return first ? first.value : '';
		}
		return this.getAttribute('value') ?? '';
	}
	set value(v: string) {
		this._value = String(v);
	}

	get checked(): boolean {
		if (this._checked !== null) return this._checked;
		return this.hasAttribute('checked');
	}
	set checked(v: boolean) {
		this._checked = !!v;
	}

	get selected(): boolean {
		if (this._selected !== null) return this._selected;
		return this.hasAttribute('selected');
	}
	set selected(v: boolean) {
		this._selected = !!v;
	}

	closest(selector: string): DomElement | null {
		return closest_from(this, compile(selector));
	}
	matches(selector: string): boolean {
		return compile(selector)(this);
	}

	private querySelectorOptions(): DomElement[] {
		const out: DomElement[] = [];
		const walk = (n: DomNode | null): void => {
			for (let c = n?._first ?? null; c; c = c._next) {
				if (c.nodeType === 1 && (c as DomElement).tagName === 'OPTION') out.push(c as DomElement);
				walk(c);
			}
		};
		walk(this);
		return out;
	}

	focus(): void {
		this.ownerDocument._active = this;
	}
	blur(): void {
		if (this.ownerDocument._active === this) this.ownerDocument._active = null;
	}

	cloneNode(deep?: boolean): DomNode {
		const copy = new DomElement(
			this.ownerDocument,
			this.namespaceURI,
			this.localName,
			this.tagName
		);
		copy._attrs = this._attrs.map((a) => ({ name: a.name, value: a.value }));
		// A clone reflects attributes, not dirty property state (matches the browser).
		if (deep) for (let n = this._first; n; n = n._next) copy.appendChild(n.cloneNode(true));
		return copy;
	}

	get outerHTML(): string {
		const attrs = this._attrs.map((a) => ` ${a.name}="${a.value}"`).join('');
		if (VOID.has(this.localName)) return `<${this.localName}${attrs}>`;
		return `<${this.localName}${attrs}>${this.innerHTML}</${this.localName}>`;
	}
	/** A `<template>`'s content: its own fragment, where its parsed markup goes. */
	_content: DomNode | null = null;
	get content(): DomNode {
		return (this._content ??= this.ownerDocument.createDocumentFragment());
	}
	set innerHTML(html: string) {
		const target = this.localName === 'template' ? this.content : this;
		target.replaceChildren(...parse(this.ownerDocument, html));
	}
	setHTMLUnsafe(html: string): void {
		this.innerHTML = html;
	}
	get innerHTML(): string {
		const s: string[] = [];
		for (let n = this._first; n; n = n._next) {
			if (n.nodeType === 1) s.push((n as DomElement).outerHTML);
			else if (n.nodeType === 8) s.push(`<!--${n.nodeValue}-->`);
			else s.push(String(n.nodeValue));
		}
		return s.join('');
	}
}

class DomDocument extends DomNode {
	_active: DomElement | null = null;
	_ids = new Map<string, DomElement>();
	readonly documentElement: DomElement;
	readonly head: DomElement;
	readonly body: DomElement;
	readyState = 'complete';
	visibilityState = 'visible';

	constructor() {
		super(null);
		this.nodeType = 9;
		this.ownerDocument = this;
		this.documentElement = this.createElement('html');
		this.head = this.createElement('head');
		this.body = this.createElement('body');
		this.documentElement.appendChild(this.head);
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
	}

	get activeElement(): DomElement | null {
		return this._active;
	}

	/** By the id map (O(1), as in a browser): the element, while it is still in this document. */
	getElementById(id: string): DomElement | null {
		const e = this._ids.get(id);
		return e && e.getAttribute('id') === id && e.getRootNode() === this ? e : null;
	}

	createElement(tag: string): DomElement {
		const l = tag.toLowerCase();
		return new DomElement(this, NS_HTML, l, l.toUpperCase());
	}
	createElementNS(ns: string, name: string): DomElement {
		if (ns === NS_HTML) return new DomElement(this, ns, name.toLowerCase(), name.toUpperCase());
		// SVG (and other) namespaces preserve source case for both localName and tagName.
		return new DomElement(this, ns, name, name);
	}
	createTextNode(data: string): DomText {
		return new DomText(this, data, 3);
	}
	createComment(data: string): DomText {
		return new DomText(this, data, 8);
	}
	createDocumentFragment(): DomNode {
		const f = new DomNode(this);
		f.nodeType = 11;
		return f;
	}

	importNode(node: DomNode, deep?: boolean): DomNode {
		return node.cloneNode(deep);
	}
}

/** The descendants of `root` a minimal selector list matches, in document order (`first`: stop at one). */
function select(root: DomNode, selector: string, first: boolean): DomElement[] {
	const test = compile(selector);
	const out: DomElement[] = [];
	const walk = (n: DomNode): boolean => {
		for (let c = n._first; c; c = c._next) {
			if (c.nodeType !== 1) continue;
			const e = c as DomElement;
			if (test(e)) {
				out.push(e);
				if (first) return true;
			}
			if (walk(c)) return true;
		}
		return false;
	};
	walk(root);
	return out;
}

/**
 * A minimal selector list as a test: each part a tag (or `*`) and any number of `[attr]` /
 * `[attr="value"]` / `[attr~="word"]` (each with an optional ` i`), and `:not()` of one of those.
 * Anything else throws, so a test never silently matches the wrong thing.
 */
function compile(selector: string): (e: DomElement) => boolean {
	const tests = selector.split(',').map((raw) => {
		const part = raw.trim();
		const head = part.match(/^([a-zA-Z][\w-]*|\*)?/)!;
		const tag = head[1] && head[1] !== '*' ? head[1].toLowerCase() : null;
		const attrs: Array<(e: DomElement) => boolean> = [];
		const re = /(:not\()?\[([\w-]+)(?:(~?=)"([^"]*)"(\s+i)?)?\](\))?/y;
		let at = head[0].length;
		for (;;) {
			re.lastIndex = at;
			const m = re.exec(part);
			if (!m || !m[1] !== !m[6]) break;
			const test = attr_test(m[2], m[3] ?? null, m[4] ?? null, m[5] !== undefined);
			attrs.push(m[1] ? (e) => !test(e) : test);
			at = re.lastIndex;
		}
		if (at !== part.length || head[0].length + attrs.length === 0)
			throw new Error(`dom shim: unsupported selector ${part}`);
		// (an HTML element's localName is lower case already; the tag is checked first, as a browser's
		// matcher does, so most elements cost one comparison)
		return (e: DomElement) => {
			if (tag !== null && e.localName !== tag) return false;
			for (const t of attrs) if (!t(e)) return false;
			return true;
		};
	});
	if (tests.length === 1) return tests[0];
	return (e) => {
		for (const t of tests) if (t(e)) return true;
		return false;
	};
}

/** `[name]`, `[name="v"]`, `[name~="v"]` (one of its words), `i`: the value's case ignored. */
function attr_test(
	name: string,
	op: string | null,
	value: string | null,
	fold: boolean
): (e: DomElement) => boolean {
	if (op === null || value === null) return (e) => e.hasAttribute(name);
	const want = fold ? value.toLowerCase() : value;
	return (e) => {
		const raw = e.getAttribute(name);
		if (raw === null) return false;
		const v = fold ? raw.toLowerCase() : raw;
		return op === '=' ? v === want : v.split(/\s+/).includes(want);
	};
}

/** The nearest inclusive ancestor element `test` matches. */
function closest_from(n: DomNode | null, test: (e: DomElement) => boolean): DomElement | null {
	if (!n || n.nodeType !== 1) return null;
	return test(n as DomElement) ? (n as DomElement) : closest_from(n._parent, test);
}

/** Run `e`'s listeners at `n`, then (a bubbling event) at each ancestor. */
function dispatch_at(n: DomNode, e: Event): void {
	const list = n._listeners?.get(e.type);
	if (list) {
		Object.defineProperty(e, 'currentTarget', { value: n, configurable: true });
		// (a copy: a listener may remove itself while it runs)
		for (const fn of list.slice()) fn(e);
	}
	if (e.bubbles && n._parent) dispatch_at(n._parent, e);
}

// ---------------------------------------------------------------------------
// A minimal HTML parser — enough for the compact, well-formed strings the tests feed it.
// ---------------------------------------------------------------------------

function parse_tag(src: string): { name: string; attrs: Attr[] } {
	const m = src.match(/^\s*([^\s/>]+)/);
	const name = m ? m[1] : '';
	const attrs: Attr[] = [];
	const rest = src.slice(m ? m[0].length : 0);
	const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
	let a: RegExpExecArray | null;
	while ((a = re.exec(rest)) !== null) {
		const val = a[2] ?? a[3] ?? a[4] ?? '';
		attrs.push({ name: a[1], value: val });
	}
	return { name, attrs };
}

function parse(doc: DomDocument, html: string): DomNode[] {
	const root = doc.createDocumentFragment();
	const stack: Array<{ node: DomNode; ns: string }> = [{ node: root, ns: NS_HTML }];
	const top = (): { node: DomNode; ns: string } => stack[stack.length - 1];
	let i = 0;

	while (i < html.length) {
		if (html[i] === '<') {
			if (html.startsWith('<!--', i)) {
				const end = html.indexOf('-->', i + 4);
				top().node.appendChild(doc.createComment(html.slice(i + 4, end)));
				i = end + 3;
				continue;
			}
			if (html[i + 1] === '/') {
				const end = html.indexOf('>', i);
				stack.pop();
				i = end + 1;
				continue;
			}
			const end = html.indexOf('>', i);
			let content = html.slice(i + 1, end);
			let self_close = false;
			if (content.endsWith('/')) {
				self_close = true;
				content = content.slice(0, -1);
			}
			const { name, attrs } = parse_tag(content);
			const parent = top();
			const lname = parent.ns === NS_SVG ? name : name.toLowerCase();
			let ns = parent.ns;
			if (lname.toLowerCase() === 'svg') ns = NS_SVG;
			const el = doc.createElementNS(ns, ns === NS_SVG ? name : lname);
			for (const at of attrs) el.setAttribute(at.name, at.value);
			parent.node.appendChild(el);
			i = end + 1;
			if (!self_close && !VOID.has(lname.toLowerCase())) {
				const child_ns = lname.toLowerCase() === 'foreignobject' ? NS_HTML : ns;
				stack.push({ node: el, ns: child_ns });
			}
		} else {
			const next = html.indexOf('<', i);
			const end = next === -1 ? html.length : next;
			top().node.appendChild(doc.createTextNode(html.slice(i, end)));
			i = end;
		}
	}
	return root.childNodes;
}

// ---------------------------------------------------------------------------
// MutationObserver: `childList`, `characterData` (through `data`; a `nodeValue` write is not seen)
// and `subtree`, records taken with `takeRecords()` or delivered in a microtask, as the browser
// does. A mutation reads one counter when nothing observes.
// ---------------------------------------------------------------------------

type MutationKind = 'childList' | 'characterData';
interface ObserveOptions {
	childList?: boolean;
	characterData?: boolean;
	subtree?: boolean;
	attributes?: boolean;
}
interface DomMutationRecord {
	type: MutationKind;
	target: DomNode;
	addedNodes: DomNode[];
	removedNodes: DomNode[];
	previousSibling: DomNode | null;
	nextSibling: DomNode | null;
}

/** Registrations across every observer: 0 means a mutation records nothing. */
let observing = 0;

class DomMutationObserver {
	_callback: (records: DomMutationRecord[], observer: DomMutationObserver) => void;
	_targets = new Map<DomNode, ObserveOptions>();
	_records: DomMutationRecord[] = [];
	_queued = false;

	constructor(callback: (records: DomMutationRecord[], observer: DomMutationObserver) => void) {
		this._callback = callback;
	}
	observe(target: DomNode, options: ObserveOptions): void {
		if (options.attributes)
			throw new Error('dom stub: MutationObserver attributes are not supported');
		if (!this._targets.has(target)) {
			observing++;
			(target._observers ??= []).push(this);
		}
		this._targets.set(target, options);
	}
	disconnect(): void {
		for (const t of this._targets.keys()) {
			t._observers!.splice(t._observers!.indexOf(this), 1);
			observing--;
		}
		this._targets.clear();
		this._records = [];
	}
	takeRecords(): DomMutationRecord[] {
		const out = this._records;
		this._records = [];
		return out;
	}
	_queue(record: DomMutationRecord): void {
		this._records.push(record);
		if (this._queued) return;
		this._queued = true;
		queueMicrotask(() => {
			this._queued = false;
			if (this._records.length) this._callback(this.takeRecords(), this);
		});
	}
}

/** One record per interested observer: one on the target, or on an ancestor with `subtree`. */
function notify(
	target: DomNode,
	type: MutationKind,
	addedNodes: DomNode[],
	removedNodes: DomNode[],
	previousSibling: DomNode | null,
	nextSibling: DomNode | null
): void {
	let told: Set<DomMutationObserver> | null = null;
	for (let n: DomNode | null = target; n; n = n._parent) {
		if (!n._observers) continue;
		for (const o of n._observers) {
			const opts = o._targets.get(n)!;
			if (!opts[type] || (n !== target && !opts.subtree) || told?.has(o)) continue;
			(told ??= new Set()).add(o);
			o._queue({ type, target, addedNodes, removedNodes, previousSibling, nextSibling });
		}
	}
}

// ---------------------------------------------------------------------------
// Install globals + export test helpers.
// ---------------------------------------------------------------------------

export const document = new DomDocument();
(globalThis as unknown as { document: DomDocument }).document = document;
(globalThis as unknown as { Node: typeof DomNode }).Node = DomNode;
(globalThis as unknown as { MutationObserver: typeof DomMutationObserver }).MutationObserver =
	DomMutationObserver;

/** Parse HTML and return its top-level nodes (the `new_nodes` array for `morph_children`). */
export function frag(html: string): DomNode[] {
	return parse(document, html);
}

/** Parse HTML expecting a single root element and return it (the live `parent`). */
export function el(html: string): DomElement {
	const nodes = parse(document, html);
	const first = nodes.find((n) => n.nodeType === 1);
	if (!first) throw new Error(`no element in: ${html}`);
	return first as DomElement;
}

export { DomElement, DomText, DomNode, NS_SVG, NS_HTML, FORMISH };
