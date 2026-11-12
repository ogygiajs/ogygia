// The page seed and the remote seed are side channels the handle writes at the end of <body>
// (runtime/seeds.ts, runtime/remote-seeds.ts). Markup the page carries earlier (a CMS block rendered
// raw, a sanitizer that keeps scripts of a type that does not run) can hold a script of the same
// type. Islands read the server's seed, never the markup's (#893). The server's seed here bears
// the mark of this response's head runtime script, as the handle writes both.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { prepare_spa_document, seed_page_once } from '../../src/runtime/seeds.ts';
import { install as install_remote_seeds } from '../../src/runtime/remote-seeds.ts';
import { slots } from '../../src/runtime/slots.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { query_responses } from '../../src/shims/kit-remote/client-stub.ts';

link_boot();
install_remote_seeds();

const MARK = 'm1';
const placed: Element[] = [];

function script(parent: HTMLElement, type: string, text: string, mark: string | null): void {
	const el = document.createElement('script');
	el.type = type;
	if (mark !== null) el.setAttribute('data-og-dt', mark);
	// (plain JSON, the lane a page seed without custom types takes: runtime/wire-format.ts)
	if (type === 'application/ogygia-page') el.setAttribute('data-og-format', 'json');
	el.textContent = text;
	parent.append(el);
	placed.push(el);
}
/** The head runtime script, with this response's mark (a type that does not run: a stand-in). */
const runtime_script = () => {
	const el = document.createElement('script');
	el.setAttribute('data-ogygia-runtime', '');
	el.setAttribute('data-og-dt', MARK);
	el.type = 'application/x-runtime-stand-in';
	document.head.prepend(el);
	placed.push(el);
};
/** A block of page markup in the body, before the handle's tail. */
const markup_block = () => {
	const div = document.createElement('div');
	document.body.append(div);
	placed.push(div);
	return div;
};
const page_seed = (who: string) => JSON.stringify({ data: { who } });

beforeEach(() => {
	prepare_spa_document();
	for (const k in query_responses) delete query_responses[k];
	runtime_script();
});
afterEach(() => {
	for (const el of placed.splice(0)) el.remove();
});

it("islands read the server's page seed, not one the page markup carries before it", () => {
	script(markup_block(), 'application/ogygia-page', page_seed('markup'), null);
	script(document.body, 'application/ogygia-page', page_seed('server'), MARK);

	seed_page_once();

	expect((page_state.data as { who?: string }).who).toBe('server');
});

it("islands read the server's remote seed, not one the page markup carries before it", () => {
	script(
		markup_block(),
		'application/ogygia-remote',
		stringify({ q: { 'q/key': 'markup' } }),
		null
	);
	script(document.body, 'application/ogygia-remote', stringify({ q: { 'q/key': 'server' } }), MARK);

	slots.remoteSeeds!.seed_once();

	expect(query_responses['q/key']).toBe('server');
});
