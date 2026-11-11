// A streamed page's late boot goes at the end of the document's head, found the way a browser reads
// the head: from its start tag to its end tag, `</head` with whitespace before the `>` included.
import { describe, expect, it } from 'vitest';
import { LATE_BOOT_SCRIPT } from '@ogygia/core/plugin';
import { stream_document } from '../src/stream.ts';

async function* none(): AsyncGenerator<never> {}

const streamed = (doc: string) => stream_document(doc, new Response(''), none()).text();

describe('the late boot in a streamed page', () => {
	it('lands before a head end tag written with a space', async () => {
		const out = await streamed('<html><head><title>x</title></head\n><body></body></html>');
		expect(out).toBe(
			`<html><head><title>x</title>${LATE_BOOT_SCRIPT}</head\n><body></body></html>`
		);
	});

	it('lands in the head, not in a comment before it that names the end tag', async () => {
		const out = await streamed('<!-- no </head> here --><html><head></head><body></body></html>');
		expect(out).toBe(
			`<!-- no </head> here --><html><head>${LATE_BOOT_SCRIPT}</head><body></body></html>`
		);
	});
});
