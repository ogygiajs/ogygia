// THE SCRIPT-URL TABLE: one list of values and whether a browser runs each as script when it
// follows it as a URL. Every caller of src/script-url.ts runs it: core's html.ts
// (test/script-url.test.ts) and the rewrite restorer, as a module and inline
// (packages/rewrite/test/browser/script-url.test.ts). Each case is also checked against the
// URL parser itself (Node's, and each browser's).

export interface ScriptUrlCase {
	readonly name: string;
	readonly value: string;
	readonly script: boolean;
}

export const SCRIPT_URL_CASES: readonly ScriptUrlCase[] = [
	{ name: 'javascript:', value: 'javascript:alert(1)', script: true },
	{ name: 'vbscript:', value: 'vbscript:msgbox(1)', script: true },
	{ name: 'data:', value: 'data:text/html,<script>alert(1)</script>', script: true },
	{ name: 'data: with nothing after', value: 'data:', script: true },
	{ name: 'mixed case', value: 'JaVaScRiPt:alert(1)', script: true },
	{ name: 'upper case data:', value: 'DATA:text/html;base64,PHNjcmlwdD4=', script: true },
	{ name: 'a tab inside the scheme', value: 'java\tscript:alert(1)', script: true },
	{ name: 'a newline inside the scheme', value: 'jav\nascript:alert(1)', script: true },
	{ name: 'a CR before the colon', value: 'javascript\r:alert(1)', script: true },
	{ name: 'tab, LF and CR all through', value: 'j\ta\nv\rascript:alert(1)', script: true },
	{ name: 'a leading NUL', value: '\u0000javascript:alert(1)', script: true },
	{
		name: 'leading controls and spaces',
		value: ' \t\u0001\u001f javascript:alert(1)',
		script: true
	},
	{ name: 'a leading form feed and VT', value: '\u000c\u000bdata:text/html,x', script: true },
	{ name: 'trailing controls and spaces', value: 'javascript:alert(1) \u0000', script: true },
	{ name: 'https:', value: 'https://example.com/a?b=c', script: false },
	{ name: 'upper case http:', value: 'HTTP://example.com/', script: false },
	{ name: 'mailto:', value: 'mailto:someone@example.com', script: false },
	{ name: 'tel:', value: 'tel:+15550100', script: false },
	{ name: 'a path', value: '/next?a=1&b=2', script: false },
	{ name: 'a relative path that names javascript:', value: './javascript:alert(1)', script: false },
	{ name: 'a query that names javascript:', value: '?q=javascript:alert(1)', script: false },
	{ name: 'a fragment', value: '#top', script: false },
	{ name: 'empty', value: '', script: false },
	{ name: 'javascript with no colon', value: 'javascript', script: false },
	{ name: 'a longer scheme that starts with javascript', value: 'javascripts:x', script: false },
	{ name: 'a scheme that ends with data', value: 'xdata:x', script: false },
	{ name: 'a scheme with a digit', value: 'data1:x', script: false },
	{ name: 'a space before the colon', value: 'javascript :alert(1)', script: false },
	{ name: 'a space inside the scheme', value: 'java script:alert(1)', script: false },
	{ name: 'a NUL inside the scheme', value: 'java\u0000script:alert(1)', script: false },
	{ name: 'a form feed inside the scheme', value: 'java\u000cscript:alert(1)', script: false },
	{
		name: 'a leading no-break space',
		value: `${String.fromCharCode(0xa0)}javascript:alert(1)`,
		script: false
	},
	{
		name: 'a leading byte order mark',
		value: `${String.fromCharCode(0xfeff)}javascript:alert(1)`,
		script: false
	},
	{ name: 'a character reference left as text', value: '&#106;avascript:alert(1)', script: false }
];

const SCRIPT_SCHEMES: ReadonlySet<string> = new Set(['javascript:', 'vbscript:', 'data:']);

/** What the URL parser running here says: its scheme against a base, or false if it fails. */
export function parser_says_script(value: string): boolean {
	try {
		return SCRIPT_SCHEMES.has(new URL(value, 'https://base.example/dir/').protocol);
	} catch {
		// oxlint-disable-next-line ogygia/no-silent-failures -- a value the parser refuses is never followed, so never script
		return false;
	}
}
