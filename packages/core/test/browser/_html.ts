// The parsers the tests call with HTML of their own: a test's markup stands in for the page's own
// (runtime/html-sink.ts `vouch_page_html`), so it goes through the sink like an answer would.
import { region_fragment as fragment_of } from '../../src/runtime/core.ts';
import { parse_region_html as parse, vouch_page_html } from '../../src/runtime/html-sink.ts';

export const parse_region_html = (html: string): DocumentFragment => parse(vouch_page_html(html));

export const region_fragment = (html: string): ReturnType<typeof fragment_of> =>
	fragment_of(vouch_page_html(html));
