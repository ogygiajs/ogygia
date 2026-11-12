// The devtools stream's server events come from the handle's side channel (events/sinks.ts
// `ingest_server_events`). Markup the page carries (a CMS block rendered raw) can hold a channel
// too, with well-formed events. Only the channel that bears the mark the head runtime script bears
// (the handle wrote both, for this response) feeds the stream (#881).
import { afterEach, beforeEach, expect, it } from 'vitest';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { ingest_server_events } = await import('../../src/events/sinks.ts');
const { snapshot, clear, configure } = await import('../../src/events/bus.ts');

const placed: Element[] = [];
const event = (name: string) => ({ v: 1, seq: 0, t: 0, realm: 'server', domain: 'server', name });

function add(parent: HTMLElement, el: Element): void {
	parent.append(el);
	placed.push(el);
}
function runtime_script(mark: string | null): void {
	const el = document.createElement('script');
	el.setAttribute('data-ogygia-runtime', '');
	if (mark !== null) el.setAttribute('data-og-dt', mark);
	// (a type the browser does not run: the element stands in for the bootstrap)
	el.type = 'application/x-runtime-stand-in';
	add(document.head, el);
}
function channel(names: string[], mark: string | null): void {
	const el = document.createElement('script');
	el.type = 'application/ogygia-devtools';
	if (mark !== null) el.setAttribute('data-og-dt', mark);
	el.textContent = JSON.stringify(names.map(event));
	add(document.body, el);
}
const names = () => snapshot().map((e) => e.name);

beforeEach(() => {
	clear();
	configure({ active: true, cap: 4096 });
});
afterEach(() => {
	for (const el of placed.splice(0)) el.remove();
});

it("only the server's own channel feeds the devtools stream, not one the markup carries", () => {
	runtime_script('m1');
	channel(['server.render'], 'm1');
	channel(['fake.unmarked'], null);
	channel(['fake.other-mark'], 'm2');
	ingest_server_events();
	expect(names()).toEqual(['server.render']);
});

it('a document whose head runtime script carries no mark feeds nothing', () => {
	runtime_script(null);
	channel(['fake.unmarked'], null);
	channel(['fake.marked'], '');
	ingest_server_events();
	expect(names()).toEqual([]);
});
