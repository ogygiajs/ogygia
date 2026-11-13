// The inline late boot swaps a streamed late chunk into its slot while the document parses. It finds
// the slot and asks whether the head has a chunk's sheet by attribute value, so a value with a quote
// or a backslash must be escaped, as the SPA twin (apply_late_templates) does (#1361).
import { afterEach, expect, test } from 'vitest';
import { LATE_BOOT_SCRIPT, late_chunk, late_slot } from '../../src/server/late-wire.ts';

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
	for (const f of frames.splice(0)) f.remove();
});

/** Parse a streamed document (the late boot first in its head, a slot, then its late chunk) in a
 *  frame, and resolve with that document once it loaded. */
function parse(head: string, slot: string, chunk: string): Promise<Document> {
	const frame = document.createElement('iframe');
	frames.push(frame);
	const loaded = new Promise<Document>((resolve) => {
		frame.addEventListener('load', () => resolve(frame.contentDocument!), { once: true });
	});
	frame.srcdoc = `<!doctype html><html><head>${LATE_BOOT_SCRIPT}${head}</head><body>${slot}${chunk}</body></html>`;
	document.body.append(frame);
	return loaded;
}

const attr = (v: string) => v.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

for (const href of ['/a.css', '/a"b.css', '/a\\"b.css', '/a\\62.css']) {
	test(`a late chunk whose sheet href is ${href} swaps in, and its sheet is in the head once`, async () => {
		const sheet = `<link rel="stylesheet" href="${attr(href)}">`;
		const doc = await parse(
			sheet,
			late_slot('s1', '<p>waiting</p>'),
			late_chunk('s1', `${sheet}<p id="came">came</p>`)
		);
		expect(doc.querySelector('og-late-slot #came')).not.toBeNull();
		expect(doc.querySelectorAll('template')).toHaveLength(0);
		const hrefs = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'), (l) =>
			l.getAttribute('href')
		);
		expect(hrefs).toEqual([href]);
	});
}

test('a late chunk whose slot id holds a quote swaps into that slot', async () => {
	const id = 'a"b';
	const doc = await parse(
		'',
		late_slot(attr(id), '<p>waiting</p>'),
		late_chunk(attr(id), '<p id="came">came</p>')
	);
	expect(doc.querySelector('og-late-slot #came')).not.toBeNull();
});
