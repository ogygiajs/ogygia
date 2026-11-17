// CODE ORIGINS (runtime/code-origins.ts): the origins island code may load from besides the page's
// and the runtime's own are read from `data-og-origins` on the FIRST runtime script in the head (the
// server's, placed before any markup), and only a token that is exactly an http(s) origin counts.
// Over any attribute the server writes and any runtime-looking scripts markup adds after it: the
// extra origins are exactly the server's exact-origin tokens (#887).
import { afterEach, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { code_origins, forget_code_origins } from '../../src/runtime/code-origins.ts';

/** tokens that are exactly an origin */
const ORIGINS = ['https://a.example', 'http://b.example:8080'];
/** tokens that are not: a path, a trailing slash, another scheme, upper case, a default port */
const NOT_ORIGINS = [
	'https://c.example/x',
	'https://c.example/',
	'javascript:alert(1)',
	'data:text/javascript,1',
	'HTTPS://D.EXAMPLE',
	'https://e.example:443',
	'',
	'not a url'
];
const token = fc.constantFrom(...ORIGINS, ...NOT_ORIGINS);
const attr = fc.array(token, { maxLength: 4 }).map((t) => t.join(' '));

const placed: Element[] = [];
afterEach(() => {
	for (const el of placed.splice(0)) el.remove();
	forget_code_origins();
});
function runtime_script(origins: string | null, first: boolean): void {
	const el = document.createElement('script');
	el.type = 'application/x-inert'; // (the attributes are what is read; nothing runs)
	el.setAttribute('data-ogygia-runtime', '');
	if (origins !== null) el.setAttribute('data-og-origins', origins);
	if (first) document.head.prepend(el);
	else document.head.append(el);
	placed.push(el);
}

it("the extra code origins are exactly the exact-origin tokens on the head's first runtime script", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.option(attr, { nil: null }),
			fc.array(attr, { maxLength: 3 }),
			async (server, markup) => {
				for (const el of placed.splice(0)) el.remove();
				runtime_script(server, true);
				for (const m of markup) runtime_script(m, false);
				forget_code_origins();
				const extra = [...code_origins()].filter((o) => o !== location.origin);
				const expected = ORIGINS.filter((o) => (server ?? '').split(' ').includes(o));
				expect(extra.sort()).toEqual(expected.sort());
			}
		),
		{ numRuns: 60 }
	);
});
