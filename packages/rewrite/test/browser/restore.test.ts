// THE RESTORER (src/restore.ts), in a real browser: markup a scoped server render reshaped
// (test/fixtures/fake-scoped-render.ts) comes back in the form hydration and the component runtime
// expect — each planned host a shadow root holding its rendered tree, Svelte's children back in its
// light DOM exactly as Svelte rendered them, the host's attributes back to Svelte's — in the document,
// in an answer's inert fragment (sheets adopted after the insertion), and never into a root a
// component's constructor made.
import { afterEach, expect, test, vi } from 'vitest';
import { check_script, STAND_IN_TAGS, transformMarkup } from '../../src/reversible.ts';
import { restore, restore_adopt } from '../../src/restore.ts';
import { fake_scoped } from '../fixtures/fake-scoped-render.ts';
import { init_shadow_registries } from '../../../core/src/runtime/html-sink.ts';

const SHEET = '<template data-og-head="demo-card.shadow">b{color:rgb(255, 0, 0)}</template>';
const island = (inner: string) =>
	`<ogygia-region entry="./a.js" data-og-fp="f1">${inner}</ogygia-region>`;
const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

/** the settled page's body, parsed into this document (the head sheet too), and the original */
async function served(inner: string) {
	const s = await transformMarkup(doc(island(inner)), fake_scoped, { kind: 'document', dev: true });
	const body = s.html.slice(s.html.indexOf('<body>') + 6, s.html.lastIndexOf('</body>'));
	document.head.insertAdjacentHTML('beforeend', SHEET);
	document.body.innerHTML = body;
	return s;
}
/** the browser's own serialization of an HTML string (to compare against a live DOM's) */
const serialized = (html: string) => {
	const t = document.createElement('template');
	t.innerHTML = html;
	return t.innerHTML;
};

afterEach(() => {
	document.body.innerHTML = '';
	for (const t of Array.from(document.head.querySelectorAll('[data-og-head]'))) t.remove();
	(window as { __og_sheets?: unknown }).__og_sheets = undefined;
});

test('the document: a shadow root with the tree, Svelte’s children back exactly, the host’s attributes back', async () => {
	const inner = '<!--[-->   Sign in <i title="x">ok</i>  <!--]-->';
	const s = await served(`<demo-card class="own">${inner}</demo-card>`);
	expect(s.planned).toBe(1);
	expect(restore(document)).toBe(1);
	const host = document.querySelector('demo-card')!;
	// light DOM: exactly Svelte's (the trimmed text and the dropped whitespace node put back)
	expect(host.innerHTML).toBe(serialized(inner));
	// the tree in the shadow root, its slot a real slot, the keyed sheet adopted
	expect(host.shadowRoot!.querySelector('b')!.textContent).toBe('Card title');
	expect(host.shadowRoot!.querySelector('slot')!.assignedNodes().length).toBeGreaterThan(0);
	expect(host.shadowRoot!.adoptedStyleSheets.length).toBe(1);
	expect(getComputedStyle(host.shadowRoot!.querySelector('b')!).color).toBe('rgb(255, 0, 0)');
	// the host: Svelte's class (plus the token the render put on its own host — a custom element's
	// class is shared with its component; restore.ts `reset`), the renderer's og-keep attribute, no
	// ogygia marks
	expect(host.getAttribute('class')).toBe('own sc-demo-card-h');
	expect((host as Element & { __og_svelte_class?: string }).__og_svelte_class).toBe('own');
	expect(host.getAttribute('data-title')).toBe('Card');
	expect([...host.attributes].map((a) => a.name).filter((n) => n.startsWith('og-'))).toEqual([]);
	expect(document.body.innerHTML.includes('og-c')).toBe(false);
});

test('a host that names a shadow sheet the page does not carry is recorded, and its other sheets still adopted', async () => {
	(window as { __og_restore_log?: unknown[] }).__og_restore_log = [];
	await served('<demo-card class="own"> hi </demo-card>');
	const host = document.querySelector('demo-card')!;
	host.setAttribute('og-shadow', 'demo-card.shadow demo-missing.shadow');
	expect(restore(document)).toBe(1);
	const restored = document.querySelector('demo-card')!;
	expect(restored.shadowRoot!.adoptedStyleSheets.length).toBe(1);
	const log = (window as { __og_restore_log?: { kind: string; host: string; key?: string }[] })
		.__og_restore_log!;
	expect(log.map(({ kind, host, key }) => ({ kind, host, key }))).toEqual([
		{ kind: 'sheet', host: 'demo-card', key: 'demo-missing.shadow' }
	]);
});

test('a missing shadow sheet named by many hosts is logged once per key, and the log keeps room for what comes after', async () => {
	(window as { __og_restore_log?: unknown[] }).__og_restore_log = [];
	await served('<demo-card class="own"> hi </demo-card>'.repeat(60));
	for (const host of Array.from(document.querySelectorAll('demo-card')))
		host.setAttribute('og-shadow', 'demo-card.shadow demo-missing.shadow');
	expect(restore(document)).toBe(60);
	const log = (window as { __og_restore_log?: { kind: string; key?: string }[] }).__og_restore_log!;
	expect(log.filter((e) => e.kind === 'sheet')).toHaveLength(1);
	document.body.insertAdjacentHTML('beforeend', '<demo-late og-h="99"></demo-late>');
	document.querySelector('demo-late')!.attachShadow({ mode: 'open' });
	restore(document);
	expect(log.some((e) => e.kind === 'late')).toBe(true);
});

test('Svelte’s children put back into a host are known render output (a later morph may remove one)', async () => {
	await served('<demo-card><i>ok</i> text</demo-card>');
	restore(document);
	const host = document.querySelector('demo-card')!;
	const made = (window as { __og_rendered?: WeakSet<Node> }).__og_rendered;
	expect(made?.has(host.querySelector('i')!)).toBe(true);
	// the rendered tree went into the shadow root: not the host's children, not marked
	expect(made?.has(host.shadowRoot!.querySelector('b')!)).toBe(false);
});

test('a host’s attribute reset (`og-r`) never sets an on* handler or a javascript: URL', async () => {
	await served('<demo-card class="own"> hi </demo-card>');
	document.querySelector('demo-card')!.setAttribute(
		'og-r',
		JSON.stringify({
			onclick: 'window.__og_ran++',
			ONFOCUS: 'window.__og_ran++',
			href: ' \tjavascript:window.__og_ran++',
			formaction: 'JaVaScRiPt:window.__og_ran++',
			srcdoc: '<script>window.__og_ran++</script>',
			title: 'kept',
			src: '/ok.png',
			// (names that only begin with "on" are no handlers: a component's own attributes)
			online: '',
			once: 'true',
			onfoo: 'x'
		})
	);
	restore(document);
	const host = document.querySelector('demo-card')!;
	expect(host.hasAttribute('onclick')).toBe(false);
	expect(host.hasAttribute('onfocus')).toBe(false);
	expect(host.hasAttribute('href')).toBe(false);
	expect(host.hasAttribute('formaction')).toBe(false);
	expect(host.hasAttribute('srcdoc')).toBe(false);
	expect(host.getAttribute('title')).toBe('kept');
	expect(host.getAttribute('src')).toBe('/ok.png');
	expect(host.getAttribute('online')).toBe('');
	expect(host.getAttribute('once')).toBe('true');
	expect(host.getAttribute('onfoo')).toBe('x');
});

test('a host’s attribute reset (`og-r`) never sets a data: URL, which html.ts refuses too', async () => {
	await served('<demo-card class="own"> hi </demo-card>');
	document.querySelector('demo-card')!.setAttribute(
		'og-r',
		JSON.stringify({
			href: 'data:text/html,<script>window.__og_ran++</script>',
			src: ' DATA:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=',
			title: 'kept'
		})
	);
	restore(document);
	const host = document.querySelector('demo-card')!;
	expect(host.hasAttribute('href')).toBe(false);
	expect(host.hasAttribute('src')).toBe(false);
	expect(host.getAttribute('title')).toBe('kept');
});

test('a stand-in keeps the parser from splitting the page’s link, and becomes a real <a> in the tree', async () => {
	await served('<a href="/card"><demo-link>Go</demo-link></a>');
	// as parsed: the page's link still holds the host (the tree's link is a stand-in)
	expect(document.querySelector('a[href="/card"] demo-link')).not.toBeNull();
	restore(document);
	expect(document.querySelector('og-as')).toBeNull();
	expect(document.querySelector('a[href="/card"] demo-link')).not.toBeNull();
});

test('a stand-in becomes only a tag the server pass writes as one, without on* attributes', async () => {
	const w = window as { __og_ran?: number };
	w.__og_ran = 0;
	document.body.innerHTML = `<div id="c"><og-as tag="script">window.__og_ran++</og-as><og-as tag="iframe" src="about:blank"></og-as><og-as tag="object"></og-as><og-as tag="embed"></og-as><og-as tag="base" href="/x/"></og-as><og-as tag="meta"></og-as><og-as tag="link"></og-as><og-as tag="style"></og-as><og-as tag="template"></og-as><og-as tag="svg"></og-as><og-as></og-as><og-as tag="p" onclick="window.__og_ran++" class="kept">text</og-as></div>`;
	restore(document);
	await new Promise((r) => setTimeout(r, 50));
	const c = document.getElementById('c')!;
	expect(w.__og_ran).toBe(0);
	expect([...c.children].map((e) => e.localName)).toEqual([...Array(11).fill('og-as'), 'p']);
	const p = c.querySelector('p')!;
	expect(p.getAttribute('class')).toBe('kept');
	expect(p.hasAttribute('onclick')).toBe(false);
	expect(p.textContent).toBe('text');
});

test('a stand-in with an attribute name only the HTML parser accepts (`=eq`) becomes its tag, and so does every stand-in after it (#1775)', () => {
	document.body.innerHTML = `<div id="c"><og-as tag="p" =eq="y" class="a">one</og-as><og-as tag="p" class="b">two</og-as></div>`;
	restore(document);
	const c = document.getElementById('c')!;
	expect([...c.children].map((e) => e.localName)).toEqual(['p', 'p']);
	expect(c.children[0].getAttribute('=eq')).toBe('y');
	expect(c.children[1].getAttribute('class')).toBe('b');
});

test('the restorer swaps back every tag the server pass may write as a stand-in', () => {
	const tags = [...STAND_IN_TAGS];
	document.body.innerHTML = `<div id="c">${tags.map((t) => `<og-as tag="${t}"></og-as>`).join('')}</div>`;
	restore(document);
	expect([...document.getElementById('c')!.children].map((e) => e.localName)).toEqual(tags);
});

test('an answer’s fragment: restored before insertion, its sheets adopted once the host is in the page', async () => {
	const s = await transformMarkup(
		'<demo-card class="x"> hi </demo-card>',
		(h) => SHEET + fake_scoped(h),
		{ kind: 'region' }
	);
	const tpl = document.createElement('template');
	tpl.innerHTML = s.html;
	restore(tpl.content);
	const host = tpl.content.querySelector('demo-card')!;
	expect(host.shadowRoot).not.toBeNull();
	expect(host.innerHTML).toBe(' hi ');
	// the sheet moved to the head (once), adopted after the insertion
	expect(document.head.querySelectorAll('[data-og-head="demo-card.shadow"]').length).toBe(1);
	document.body.appendChild(tpl.content);
	restore_adopt();
	expect(document.querySelector('demo-card')!.shadowRoot!.adoptedStyleSheets.length).toBe(1);
});

test('a root that cannot adopt its sheet leaves the others in the answer theirs', async () => {
	const s = await transformMarkup(
		'<demo-card class="x"> a </demo-card><demo-card class="y"> b </demo-card>',
		(h) => SHEET + fake_scoped(h),
		{ kind: 'region' }
	);
	const tpl = document.createElement('template');
	tpl.innerHTML = s.html;
	restore(tpl.content);
	const [first, second] = Array.from(tpl.content.querySelectorAll('demo-card'));
	Object.defineProperty(first.shadowRoot!, 'adoptedStyleSheets', {
		configurable: true,
		get: () => [],
		set: () => {
			throw new DOMException('not this one', 'NotAllowedError');
		}
	});
	document.body.appendChild(tpl.content);
	expect(() => restore_adopt()).not.toThrow();
	expect(second.shadowRoot!.adoptedStyleSheets.length).toBe(1);
});

test('a mangled attribute reset (`og-r`) leaves the host’s attributes as served, and its mark gone', async () => {
	await served('<demo-card class="own" title="served"> hi </demo-card>');
	document.querySelector('demo-card')!.setAttribute('og-r', '{"title": "svelte"');
	expect(restore(document)).toBe(1);
	const host = document.querySelector('demo-card')!;
	expect(host.getAttribute('title')).toBe('served');
	expect(host.hasAttribute('og-r')).toBe(false);
	expect(host.shadowRoot!.querySelector('b')!.textContent).toBe('Card title');
});

test('a text mark whose original does not parse carries none: the text stays as served, the mark gone', async () => {
	await served('<demo-card class="own">   Sign in  </demo-card>');
	const marks: Comment[] = [];
	const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
	for (let n = walk.nextNode(); n; n = walk.nextNode())
		if (/^og-[ct] /.test((n as Comment).data)) marks.push(n as Comment);
	expect(marks.length).toBeGreaterThan(0);
	for (const m of marks) m.data = `${m.data.slice(0, m.data.indexOf(' "'))} "\\x`;
	expect(restore(document)).toBe(1);
	expect(document.body.innerHTML.includes('og-c')).toBe(false);
	expect(document.body.innerHTML.includes('og-t')).toBe(false);
	expect(document.querySelector('demo-card')!.textContent).toContain('Sign in');
});

test('every dev check under the root is read and consumed: a restore of a streamed page checks the hosts of every chunk, and a second restore finds nothing (found by the rewrite sim)', () => {
	(window as { __og_restore_log?: unknown[] }).__og_restore_log = [];
	const one = '<demo-card og-h="0" og-shadow="k"><slot><i og-c="0.0">a</i></slot></demo-card>';
	const two =
		'<demo-card og-h="1" og-shadow="k"><slot><i og-c="1.0">changed</i></slot></demo-card>';
	document.body.innerHTML = `${one}${check_script({ 0: '<i>a</i>' })}${two}${check_script({ 1: '<i>b</i>' })}`;
	expect(restore(document)).toBe(2);
	const log = (window as { __og_restore_log?: { kind: string }[] }).__og_restore_log!;
	expect(log.filter((e) => e.kind === 'mismatch')).toHaveLength(1);
	expect(document.body.querySelectorAll('script').length).toBe(0);
	const before = document.body.innerHTML;
	expect(restore(document)).toBe(0);
	expect(document.body.innerHTML).toBe(before);
});

test('a dev check that does not parse checks nothing: the restore goes on, and the script is consumed', async () => {
	const s = await served('<demo-card class="own"> hi </demo-card>');
	expect(s.planned).toBe(1);
	document.body.insertAdjacentHTML(
		'afterbegin',
		'<script type="application/ogygia-restore-check">{not json</script>'
	);
	let mismatch = false;
	const on = () => (mismatch = true);
	document.addEventListener('ogygia:restore-mismatch', on);
	try {
		expect(restore(document)).toBe(1);
	} finally {
		document.removeEventListener('ogygia:restore-mismatch', on);
	}
	expect(mismatch).toBe(false);
	expect(document.querySelector('script[type="application/ogygia-restore-check"]')).toBeNull();
	expect(document.querySelector('demo-card')!.innerHTML).toBe(' hi ');
});

test('a router swap: a root the swap left in the parsed page is skipped, and every root in this one gets its sheets', async () => {
	// REGRESSION (field report on 4e800c75): after a router navigation every restored header host
	// lost its sheets — the incoming page's parsed document holds roots the swap did not take (a morph
	// kept the live host), they count as connected (their document is their root), adopting a page
	// sheet into one threw "Sharing constructed stylesheets in multiple documents", and the throw
	// stopped the loop before the roots that did go in
	const s = await transformMarkup(
		doc(island('<demo-card> left </demo-card><demo-card> taken </demo-card>')),
		fake_scoped,
		{ kind: 'document' }
	);
	document.head.insertAdjacentHTML('beforeend', SHEET);
	const incoming = new DOMParser().parseFromString(s.html, 'text/html');
	restore(incoming);
	const [left, taken] = Array.from(incoming.querySelectorAll('demo-card'));
	expect(left.isConnected).toBe(true); // (connected to the parsed page, not to this one)
	document.body.appendChild(taken);
	expect(() => restore_adopt()).not.toThrow();
	expect(taken.shadowRoot!.adoptedStyleSheets.length).toBe(1);
	expect(left.shadowRoot!.adoptedStyleSheets.length).toBe(0);
	expect((window as { __og_adopt?: unknown[] }).__og_adopt).toEqual([]); // the leftover is dropped
});

test('an answer still waiting for its stylesheet keeps its roots while another answer goes in', async () => {
	const answer = async (text: string) => {
		const s = await transformMarkup(
			`<demo-card> ${text} </demo-card>`,
			(h) => SHEET + fake_scoped(h),
			{ kind: 'region' }
		);
		const tpl = document.createElement('template');
		tpl.innerHTML = s.html;
		restore(tpl.content);
		return tpl.content;
	};
	const waiting = await answer('waiting');
	const first = await answer('first');
	document.body.appendChild(first);
	restore_adopt();
	document.body.appendChild(waiting);
	restore_adopt();
	const hosts = Array.from(document.querySelectorAll('demo-card'));
	expect(hosts.map((h) => h.shadowRoot!.adoptedStyleSheets.length)).toEqual([1, 1]);
});

test('a host upgraded before the restore reached it keeps its own root; the light DOM is put back, the server’s tree dropped, and it says so', async () => {
	const inner = ' late <i>ok</i>';
	await served(`<demo-card class="own">${inner}</demo-card>`);
	const host = document.querySelector('demo-card')!;
	// what a component constructor does on upgrade: its own root, its own render
	const own = host.attachShadow({ mode: 'open' });
	own.innerHTML = '<b>Card title</b><slot></slot>';
	let late = '';
	document.addEventListener('ogygia:restore-late', (e) => (late = (e as CustomEvent).detail.host), {
		once: true
	});
	restore(document);
	expect(late).toBe('0');
	// the component's root is left as it made it
	expect(host.shadowRoot).toBe(own);
	expect(own.innerHTML).toBe('<b>Card title</b><slot></slot>');
	// the light DOM is Svelte's again: the server's rendered tree is not slotted beside the root's
	// own render (it would show twice)
	expect(host.innerHTML).toBe(serialized(inner));
	expect(host.querySelector('b')).toBeNull();
	expect(host.getAttribute('class')).toBe('own sc-demo-card-h');
	expect([...host.attributes].map((a) => a.name).filter((n) => n.startsWith('og-'))).toEqual([]);
});

test('dev: the check compares each restored host with Svelte’s children, and names the first difference', async () => {
	const inner = ' Sign in <i>ok</i>';
	// a transform that loses a child ogygia can't know about (it strips the tag along with the node)
	const lossy = (h: string) =>
		fake_scoped(h)
			.split(/<i c-id="0\.1" og-c="0\.1">ok<\/i>/)
			.join('');
	const s = await transformMarkup(
		doc(island(`<demo-card class="own">${inner}</demo-card>`)),
		lossy,
		{ kind: 'document', dev: true }
	);
	const body = s.html.slice(s.html.indexOf('<body>') + 6, s.html.lastIndexOf('</body>'));
	document.head.insertAdjacentHTML('beforeend', SHEET);
	document.body.innerHTML = check_script(s.check!) + body;
	let diff = '';
	document.addEventListener(
		'ogygia:restore-mismatch',
		(e) => (diff = (e as CustomEvent).detail.diff),
		{ once: true }
	);
	const quiet = console.error;
	console.error = () => {};
	try {
		restore(document);
	} finally {
		console.error = quiet;
	}
	expect(diff).toContain('Svelte has <i>, the restored markup has nothing');
	// (and the script is consumed)
	expect(document.querySelector('script[type="application/ogygia-restore-check"]')).toBeNull();
});

test('text a render trimmed inside a custom element it did not render comes back through the planned host above', async () => {
	const inner = '<rich-text><p>a</p>\n\t\t<p>b</p></rich-text>';
	await served(`<demo-card class="own">${inner}</demo-card>`);
	restore(document);
	// (the fake stamps its c-id on every tagged element it saw; the whitespace between is the point)
	expect((document.querySelector('rich-text')!.childNodes[1] as Text).data).toBe('\n\t\t');
});

test('the dev check reads class as tokens and style as declarations, an empty one as absent', async () => {
	const inner = '<p style="" class="">x</p><p style="--cols: 4">y</p>';
	// a serializer that normalizes class and style on every element it writes
	const normalizing = (h: string) =>
		fake_scoped(h)
			.split(' style=""')
			.join('')
			.split(' class=""')
			.join('')
			.split('--cols: 4"')
			.join('--cols: 4;"');
	const s = await transformMarkup(
		doc(island(`<demo-card class="own">${inner}</demo-card>`)),
		normalizing,
		{ kind: 'document', dev: true }
	);
	const body = s.html.slice(s.html.indexOf('<body>') + 6, s.html.lastIndexOf('</body>'));
	document.head.insertAdjacentHTML('beforeend', SHEET);
	document.body.innerHTML = check_script(s.check!) + body;
	let diff = '';
	document.addEventListener(
		'ogygia:restore-mismatch',
		(e) => (diff = (e as CustomEvent).detail.diff),
		{ once: true }
	);
	restore(document);
	expect(diff).toBe('');
});

test('a custom element keeps the class tokens its render added beside Svelte’s (recorded for the hydrate); a plain element gets Svelte’s alone', async () => {
	const check = async (inner: string, edit: (h: string) => string) => {
		const s = await transformMarkup(
			doc(island(`<demo-card class="own">${inner}</demo-card>`)),
			(h) => edit(fake_scoped(h)),
			{ kind: 'document', dev: true }
		);
		const body = s.html.slice(s.html.indexOf('<body>') + 6, s.html.lastIndexOf('</body>'));
		document.head.insertAdjacentHTML('beforeend', SHEET);
		document.body.innerHTML = check_script(s.check!) + body;
		let diff = '';
		document.addEventListener(
			'ogygia:restore-mismatch',
			(e) => (diff = (e as CustomEvent).detail.diff),
			{ once: true }
		);
		const quiet = console.error;
		console.error = () => {};
		try {
			restore(document);
		} finally {
			console.error = quiet;
		}
		return diff;
	};
	const slider = () =>
		document.querySelector('x-slider') as Element & { __og_svelte_class?: string };
	// the component adds `bottom center` to its own host: kept beside Svelte's, Svelte's recorded, no report
	expect(
		await check('<x-slider class="gap-6">a</x-slider>', (h) =>
			h.split('class="gap-6"').join('class="gap-6 bottom center"')
		)
	).toBe('');
	expect(slider().getAttribute('class')).toBe('gap-6 bottom center');
	expect(slider().__og_svelte_class).toBe('gap-6');
	// a token of Svelte's the render dropped comes back; the component's stays
	expect(
		await check('<x-slider class="gap-6 wide">a</x-slider>', (h) =>
			h.split('class="gap-6 wide"').join('class="gap-6 bottom"')
		)
	).toBe('');
	expect(slider().getAttribute('class')).toBe('gap-6 wide bottom');
	// a plain element is Svelte's alone: exactly Svelte's class again
	expect(
		await check('<p class="gap-6">a</p>', (h) =>
			h.split('class="gap-6"').join('class="gap-6 extra"')
		)
	).toBe('');
	expect(document.querySelector('demo-card p')!.getAttribute('class')).toBe('gap-6');
});

test('a Kit-hydrated page: the first whole write to Svelte’s tokens gets back what it dropped; the component’s own later removals stand', async () => {
	const meta = document.createElement('meta');
	meta.name = 'ogygia-csr';
	meta.content = 'true';
	document.head.append(meta);
	const W = window as { __og_class_watch?: { hosts: Set<Element> } };
	try {
		await served('<demo-card class="own"> x </demo-card><demo-card class="other"> y </demo-card>');
		restore(document);
		const [a, b] = Array.from(document.querySelectorAll('demo-card'));
		expect(W.__og_class_watch!.hosts.size).toBe(2);
		a.classList.add('bottom', 'center'); // the component's first render (before Kit's hydrate)
		a.className = 'own'; // Kit's hydrate: Svelte's tokens, whole
		await Promise.resolve();
		expect(a.className).toBe('own sc-demo-card-h bottom center');
		// the component drops one of its own later: it stays dropped (the host left the watch)
		a.classList.remove('center');
		await Promise.resolve();
		expect(a.className).toBe('own sc-demo-card-h bottom');
		expect(W.__og_class_watch!.hosts.size).toBe(1);
		// a write and the component's add in ONE batch: the write's own dropped tokens come back
		b.className = 'other';
		b.classList.add('later');
		await Promise.resolve();
		expect(b.className).toBe('other later sc-demo-card-h');
		expect(W.__og_class_watch).toBeUndefined(); // the last host had its write: the observer is gone
	} finally {
		meta.remove();
		W.__og_class_watch = undefined;
	}
});

test('a Kit-hydrated page: a watched host that leaves the document leaves the watch, a moved one stays, and the observer goes with the last one', async () => {
	const meta = document.createElement('meta');
	meta.name = 'ogygia-csr';
	meta.content = 'true';
	document.head.append(meta);
	const W = window as { __og_class_watch?: { mo: MutationObserver; hosts: Set<Element> } };
	const records = () => new Promise((r) => setTimeout(r, 0));
	try {
		await served('<demo-card class="own"> x </demo-card><demo-card class="other"> y </demo-card>');
		restore(document);
		const [a, b] = Array.from(document.querySelectorAll('demo-card'));
		const w = W.__og_class_watch!;
		expect(w.hosts.size).toBe(2);
		const disconnect = vi.spyOn(w.mo, 'disconnect');
		// a move in one task (out and back in): still the page's host, still watched
		const parent = a.parentNode!;
		const next = a.nextSibling;
		a.remove();
		parent.insertBefore(a, next);
		await records();
		expect(w.hosts.has(a)).toBe(true);
		// Kit drops a host and mounts a new one in its place: the old host leaves the watch
		const fresh = document.createElement('demo-card');
		b.replaceWith(fresh);
		await records();
		expect(w.hosts.has(b)).toBe(false);
		expect(w.hosts.size).toBe(1);
		expect(disconnect).not.toHaveBeenCalled();
		// the last host goes: nothing is left to watch, the observer goes with it
		a.remove();
		await records();
		expect(w.hosts.size).toBe(0);
		expect(disconnect).toHaveBeenCalled();
		expect(W.__og_class_watch).toBeUndefined();
	} finally {
		meta.remove();
		W.__og_class_watch?.mo.disconnect();
		W.__og_class_watch = undefined;
	}
});

test('a csr=false page arms no class watch (the island hydrate puts the tokens back)', async () => {
	await served('<demo-card class="own"> x </demo-card>');
	restore(document);
	expect((window as { __og_class_watch?: unknown }).__og_class_watch).toBeUndefined();
});

test('a DOM without adoptable sheets or CSS.escape (jsdom): a <style> per root', async () => {
	await served('<demo-card class="own"> x </demo-card>');
	const desc = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'adoptedStyleSheets')!;
	const escape = CSS.escape;
	Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
		configurable: true,
		get: () => undefined,
		set: () => {}
	});
	(CSS as { escape?: unknown }).escape = undefined;
	try {
		expect(restore(document)).toBe(1);
	} finally {
		Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', desc);
		CSS.escape = escape;
	}
	const root = document.querySelector('demo-card')!.shadowRoot!;
	expect(root.querySelector('style')!.textContent).toContain('b{color');
});

test('a planned host inside a declarative shadow root the page shipped is restored too', async () => {
	const s = await transformMarkup(
		doc(
			island(
				'<div class="wrap"><template shadowrootmode="open"><demo-card class="own"> deep </demo-card></template></div>'
			)
		),
		fake_scoped,
		{ kind: 'document' }
	);
	const body = s.html.slice(s.html.indexOf('<body>') + 6, s.html.lastIndexOf('</body>'));
	document.head.insertAdjacentHTML('beforeend', SHEET);
	document.body.setHTMLUnsafe(body);
	expect(restore(document)).toBe(1);
	const card = document.querySelector('.wrap')!.shadowRoot!.querySelector('demo-card')!;
	expect(card.shadowRoot!.querySelector('b')!.textContent).toBe('Card title');
	expect(card.innerHTML).toBe(' deep ');
});

// (a root attached in an inert document has no registry. Some engines keep it null after the
// insertion (measured in Edge: nothing inside upgraded, `attachInternals` threw), and the runtime then
// calls `customElements.initialize` on it; the Chromium these tests run in assigns it on insertion.
// So here the two tests below guard the upgrade path end to end, not the null case itself.)
test('a root restored in an answer’s inert fragment gets the page’s registry after insertion: what is inside upgrades', async () => {
	let constructed = 0;
	if (!customElements.get('demo-internal'))
		customElements.define(
			'demo-internal',
			class extends HTMLElement {
				constructor() {
					super();
					this.attachInternals(); // throws on an element no registry upgraded
					constructed++;
				}
			}
		);
	// the component's tree holds a custom element (a button in the host's shadow form)
	const tree = (h: string) =>
		fake_scoped(h)
			.split('<b class="sc-demo-card">Card title</b>')
			.join('<b class="sc-demo-card">Card title</b><demo-internal></demo-internal>');
	const s = await transformMarkup('<demo-card class="x"> hi </demo-card>', (h) => SHEET + tree(h), {
		kind: 'region'
	});
	const tpl = document.createElement('template');
	tpl.innerHTML = s.html;
	restore(tpl.content);
	document.body.appendChild(tpl.content);
	restore_adopt();
	const inner = document.querySelector('demo-card')!.shadowRoot!.querySelector('demo-internal')!;
	expect(constructed).toBe(1);
	expect(inner.constructor).not.toBe(HTMLElement);
});

test('a declarative shadow root parsed in an inert fragment gets the page’s registry after insertion (no transform needed)', async () => {
	let constructed = 0;
	if (!customElements.get('demo-internal-2'))
		customElements.define(
			'demo-internal-2',
			class extends HTMLElement {
				constructor() {
					super();
					this.attachInternals();
					constructed++;
				}
			}
		);
	const tpl = document.createElement('template');
	tpl.setHTMLUnsafe(
		'<div class="host"><template shadowrootmode="open"><demo-internal-2></demo-internal-2></template></div>'
	);
	const host = document.createElement('section');
	host.appendChild(tpl.content);
	document.body.appendChild(host);
	init_shadow_registries(host);
	expect(constructed).toBe(1);
});

/** A component in the most common shape: its constructor attaches its own root, unconditionally. */
function define_attaching(tag: string): void {
	customElements.define(
		tag,
		class extends HTMLElement {
			constructor() {
				super();
				this.attachShadow({ mode: 'open' }).innerHTML = '<i class="own">own</i><slot></slot>';
			}
		}
	);
}

/** A planned host's render: the server tree before Svelte's children, wrapped in a slot. */
const attaching_render = (tag: string) => (h: string) =>
	h.replace(
		new RegExp(`(<${tag}[^>]*)>([\\s\\S]*?)</${tag}>`),
		`$1 og-shadow="demo-card.shadow"><b>server</b><slot>$2</slot></${tag}>`
	);

/** Errors a component's upgrade reports (an upgrade never throws to its caller). */
function upgrade_errors(): { list: unknown[]; stop: () => void } {
	const list: unknown[] = [];
	const heard = (e: ErrorEvent) => {
		list.push(e.error ?? e.message);
		e.preventDefault();
	};
	window.addEventListener('error', heard);
	return { list, stop: () => window.removeEventListener('error', heard) };
}

test('a component that attaches its own root in its constructor upgrades over a restored host: the root comes back emptied, the light DOM stays Svelte’s', async () => {
	const s = await transformMarkup(
		doc(island('<demo-attach class="own"> hi <i>ok</i></demo-attach>')),
		attaching_render('demo-attach'),
		{ kind: 'document' }
	);
	expect(s.planned).toBe(1);
	document.head.insertAdjacentHTML('beforeend', SHEET);
	document.body.innerHTML = s.html.slice(
		s.html.indexOf('<body>') + 6,
		s.html.lastIndexOf('</body>')
	);
	expect(restore(document)).toBe(1);
	expect(document.querySelector('demo-attach')!.shadowRoot!.querySelector('b')!.textContent).toBe(
		'server'
	);
	const errors = upgrade_errors();
	define_attaching('demo-attach');
	errors.stop();
	expect(errors.list).toEqual([]);
	const host = document.querySelector('demo-attach')!;
	expect(host.shadowRoot!.innerHTML).toBe('<i class="own">own</i><slot></slot>');
	expect(host.innerHTML).toBe(' hi <i>ok</i>');
});

test('an answer restored in its inert fragment: a component that attaches its own root upgrades at insertion over the emptied root', async () => {
	define_attaching('demo-attach-answer');
	const s = await transformMarkup(
		'<demo-attach-answer> hi </demo-attach-answer>',
		(h) => SHEET + attaching_render('demo-attach-answer')(h),
		{ kind: 'region' }
	);
	const tpl = document.createElement('template');
	tpl.innerHTML = s.html;
	restore(tpl.content);
	expect(tpl.content.querySelector('demo-attach-answer')!.shadowRoot).not.toBeNull();
	const errors = upgrade_errors();
	document.body.appendChild(tpl.content);
	restore_adopt();
	errors.stop();
	expect(errors.list).toEqual([]);
	const host = document.querySelector('demo-attach-answer')!;
	expect(host.shadowRoot!.innerHTML).toBe('<i class="own">own</i><slot></slot>');
	expect(host.innerHTML).toBe(' hi ');
});

test('a host its component already upgraded (no root of its own yet) keeps its identity and gets the restored root', async () => {
	customElements.define('demo-lazy', class extends HTMLElement {});
	const s = await transformMarkup(
		doc(island('<demo-lazy> hi </demo-lazy>')),
		attaching_render('demo-lazy'),
		{ kind: 'document' }
	);
	document.body.innerHTML = s.html.slice(
		s.html.indexOf('<body>') + 6,
		s.html.lastIndexOf('</body>')
	);
	const before = document.querySelector('demo-lazy')!;
	expect(restore(document)).toBe(1);
	expect(document.querySelector('demo-lazy')).toBe(before);
	expect(before.shadowRoot!.querySelector('b')!.textContent).toBe('server');
	expect(before.innerHTML).toBe(' hi ');
});

test('a host whose tag name holds markup characters is restored with nothing parsed out of its name', () => {
	document.head.insertAdjacentHTML('beforeend', SHEET);
	document.body.innerHTML =
		'<x-a<img og-h="0" og-shadow="demo-card.shadow"><b>server</b><slot><!--og-c 0.0 t--> hi </slot></x-a<img>';
	expect(document.body.firstElementChild!.localName).toBe('x-a<img');
	try {
		restore(document);
	} catch {
		expect(document.body.firstElementChild!.shadowRoot).toBeNull();
	}
	const restored = document.body.firstElementChild!;
	expect(restored.localName).toBe('x-a<img');
	expect(document.querySelectorAll('img').length).toBe(0);
	expect(restored.shadowRoot?.querySelectorAll('img').length ?? 0).toBe(0);
});

test('a host that cannot have a shadow root is skipped and said; the hosts after it are restored', async () => {
	await served('<demo-card class="own"> after </demo-card>');
	(window as { __og_restore_log?: unknown[] }).__og_restore_log = [];
	document.body.insertAdjacentHTML(
		'beforeend',
		'<a og-h="9" og-shadow="demo-card.shadow" og-r="{}"><b>server</b><slot><!--og-c 9.0 t--> hi </slot></a>'
	);
	const bad = document.body.lastElementChild!;
	expect(bad.localName).toBe('a');
	let restored = -1;
	expect(() => (restored = restore(document))).not.toThrow();
	expect(restored).toBe(1);
	const host = document.querySelector('demo-card')!;
	expect(host.shadowRoot).not.toBeNull();
	expect(host.innerHTML).toBe(' after ');
	expect(bad.shadowRoot).toBeNull();
	expect([...bad.attributes].map((a) => a.name).filter((n) => n.startsWith('og-'))).toEqual([]);
	expect(bad.innerHTML.includes('og-c')).toBe(false);
	expect((window as { __og_restore_log?: unknown[] }).__og_restore_log).toContainEqual(
		expect.objectContaining({ kind: 'invalid', host: 'a' })
	);
});

test('a host with an attribute name only the HTML parser accepts (`=eq`) is restored, and so is every host after it', () => {
	document.head.insertAdjacentHTML('beforeend', SHEET);
	const host = (attrs: string) =>
		`<x-widget og-h="0" og-shadow="demo-card.shadow" ${attrs}><b>server</b><slot><!--og-c 0.0 t--> hi </slot></x-widget>`;
	document.body.innerHTML = host('@click="go" [prop]="x" =eq="y"') + host('data-n="2"');
	restore(document);
	const hosts = Array.from(document.querySelectorAll('x-widget'));
	expect(hosts.length).toBe(2);
	for (const h of hosts) {
		expect(h.shadowRoot, 'restored').not.toBeNull();
		expect(h.hasAttribute('og-h'), 'its mark gone').toBe(false);
	}
	expect(hosts[0].getAttribute('@click')).toBe('go');
	expect(hosts[0].getAttribute('[prop]')).toBe('x');
	expect(hosts[0].getAttribute('=eq')).toBe('y');
});

test('putting attributes back never adds an event handler, a srcdoc or a javascript: URL', () => {
	const w = window as { __og_ran?: number };
	w.__og_ran = 0;
	// (a host and a child of Svelte's, each with an attribute map; a URL parser drops the tab)
	const host_r = JSON.stringify({ onclick: 'window.__og_ran++', title: 'kept' });
	const child_r = JSON.stringify({
		href: ' java\tscript:window.__og_ran++',
		ONmouseover: 'window.__og_ran++',
		srcdoc: '<script>window.__og_ran++</script>',
		formaction: 'JavaScript:window.__og_ran++',
		'data-x': 'y'
	});
	const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
	document.body.innerHTML = `<demo-card og-h="k1" og-r='${attr(host_r)}'><a og-c="k1.0" og-r='${attr(child_r)}'>a</a></demo-card>`;
	expect(restore(document)).toBe(1);
	const host = document.querySelector<HTMLElement>('demo-card')!;
	const a = host.querySelector('a')!;
	expect(host.getAttribute('title')).toBe('kept');
	expect(a.getAttribute('data-x')).toBe('y');
	for (const el of [host, a])
		expect(
			[...el.attributes]
				.map((x) => x.name)
				.filter((n) => !n.startsWith('data-') && n !== 'title' && n !== 'class')
		).toEqual([]);
	host.click();
	a.dispatchEvent(new MouseEvent('mouseover'));
	expect(w.__og_ran).toBe(0);
});

test('self-contained: the function source runs on its own (the handle inlines it)', async () => {
	await served('<demo-card class="own"> inline </demo-card>');
	// oxlint-disable-next-line typescript/no-implied-eval -- the test proves the function's own source runs with no module scope
	const standalone = new Function(`return (${restore.toString()})`)() as typeof restore;
	expect(standalone(document)).toBe(1);
	expect(document.querySelector('demo-card')!.innerHTML).toBe(' inline ');
});
