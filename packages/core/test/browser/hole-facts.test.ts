// The holes record, read back (src/runtime/hole-facts.ts): what the server minted for each hole on a
// Kit-hydrated document, found by the hole's identity, parsed once per document.
import { expect, test } from 'vitest';
import { RESPONSE_MARK } from '../../src/contract/response-mark.ts';
import { hole_facts_of } from '../../src/runtime/hole-facts.ts';
import { OGYGIA_RUNTIME } from '../../src/wire-markup.ts';

/** A document whose tail carries `record` (a string is written as it is), as its server wrote it:
 *  the record bears the mark the head runtime script bears. */
const doc_with = (record: unknown) => {
	const text = typeof record === 'string' ? record : JSON.stringify(record);
	const doc = document.implementation.createHTMLDocument('');
	const runtime = doc.createElement('script');
	runtime.setAttribute(OGYGIA_RUNTIME, '');
	runtime.setAttribute(RESPONSE_MARK, 'm1');
	doc.head.append(runtime);
	const script = doc.createElement('script');
	script.type = 'application/ogygia-holes';
	script.setAttribute(RESPONSE_MARK, 'm1');
	script.textContent = text;
	doc.body.append(script);
	return { doc, script };
};

const SIDECAR = '<script type="application/json" data-ogygia-props="h1">{"n":1}</script>';

test('a hole’s facts are found by its identity: its endpoint, and its sidecar back as a script', () => {
	const { doc } = doc_with({
		h1: { endpoint: '/__ogygia__?id=a&sig=s', sidecar: SIDECAR },
		h2: { endpoint: '/__ogygia__?id=b&sig=s' }
	});
	const one = hole_facts_of(doc, 'h1')!;
	expect(one.endpoint).toBe('/__ogygia__?id=a&sig=s');
	expect(one.sidecar).toBeInstanceOf(HTMLScriptElement);
	expect(one.sidecar!.getAttribute('data-ogygia-props')).toBe('h1');
	expect(one.sidecar!.textContent).toBe('{"n":1}');
	expect(hole_facts_of(doc, 'h2')).toEqual({ endpoint: '/__ogygia__?id=b&sig=s', sidecar: null });
	expect(hole_facts_of(doc, 'nope')).toBeNull();
});

test('an entry without an endpoint, a sidecar that is not a script, a record that is not JSON, or none: nothing', () => {
	const { doc } = doc_with({
		empty: { endpoint: '' },
		odd: { endpoint: 7 },
		div: { endpoint: '/e', sidecar: '<div>not a script</div>' }
	});
	expect(hole_facts_of(doc, 'empty')).toBeNull();
	expect(hole_facts_of(doc, 'odd')).toBeNull();
	expect(hole_facts_of(doc, 'div')).toEqual({ endpoint: '/e', sidecar: null });
	expect(hole_facts_of(doc_with('{not json').doc, 'h1')).toBeNull();
	expect(hole_facts_of(document.implementation.createHTMLDocument(''), 'h1')).toBeNull();
});

test('the record is parsed once per document', () => {
	const { doc, script } = doc_with({ h1: { endpoint: '/first' } });
	expect(hole_facts_of(doc, 'h1')!.endpoint).toBe('/first');
	script.textContent = JSON.stringify({ h1: { endpoint: '/second' } });
	expect(hole_facts_of(doc, 'h1')!.endpoint).toBe('/first');
});

test('a recorded sidecar never runs: a script in the record is parsed inert', () => {
	const ran = globalThis as { __og_facts_ran?: number };
	ran.__og_facts_ran = 0;
	const { doc } = doc_with({
		h1: { endpoint: '/e', sidecar: '<script>globalThis.__og_facts_ran++</script>' }
	});
	const facts = hole_facts_of(doc, 'h1')!;
	document.body.append(facts.sidecar!);
	facts.sidecar!.remove();
	expect(ran.__og_facts_ran).toBe(0);
});
