// attr_changes (contract/markup-text.ts) reads each tag the way the browser does (#1370): a tag ends
// at its first `>` outside a quoted value, a value is read in any quoting, with spaces around `=`,
// names in any case, and the first of two same-name attributes wins. The page beacon's copy is held
// to the same answers (devtools test/profiler-page-beacon-parity.test.ts).
import { describe, expect, it } from 'vitest';
import { attr_changes, without_comments } from '../src/contract/markup-text.ts';

/** `data-x` written each way the browser reads it as holding `v`. */
const spellings = (v: string): string[] => [
	`data-x="${v}"`,
	`data-x='${v}'`,
	...(/[\s"'<>=`]/.test(v) ? [] : [`data-x=${v}`]),
	`DATA-X = "${v}"`
];

/** Attributes around it that a hand parser trips on (the same on both sides). */
const AROUND = [
	'',
	'title="x>y"',
	"title='a<b'",
	'title="say \'hi\'"',
	'title=\'say "hi"\'',
	'title="&quot;=&gt;"',
	'title=a/b'
];

describe('attr_changes reads a tag as the browser does', () => {
	for (const lead of AROUND)
		for (const [i, one] of spellings('1').entries()) {
			const two = spellings('2')[i];
			it(`<a ${lead} ${one}> to ${two}`, () => {
				expect(attr_changes(`<a ${lead} ${one}>go</a>`, `<a ${lead} ${two}>go</a>`)).toEqual([
					{ tag: 'a', name: 'data-x', from: '1', to: '2' }
				]);
			});
		}

	it('a value holding `>` is one value, read whole', () => {
		expect(attr_changes('<a title="x>1">go</a>', '<a title="x>2">go</a>')).toEqual([
			{ tag: 'a', name: 'title', from: 'x>1', to: 'x>2' }
		]);
	});

	it('the first of two same-name attributes is the one the browser keeps', () => {
		expect(
			attr_changes('<a data-x="1" data-x="9">go</a>', '<a data-x="2" data-x="9">go</a>')
		).toEqual([{ tag: 'a', name: 'data-x', from: '1', to: '2' }]);
	});

	it('a script whose text holds `<` and differs is not attributes only', () => {
		expect(attr_changes('<script>if(a<b)go(1)</script>', '<script>if(a<b)go(2)</script>')).toBe(
			null
		);
		expect(
			attr_changes(
				'<script>if(a<b)go(1)</script><i id="1"></i>',
				'<script>if(a<b)go(1)</script><i id="2"></i>'
			)
		).toEqual([{ tag: 'i', name: 'id', from: '1', to: '2' }]);
	});
});

describe('without_comments drops the comments the browser reads, and only those', () => {
	it('a comment ends where the browser ends it: `-->`, `--!>`, and at once for `<!-->` and `<!--->`', () => {
		expect(without_comments('<!-- a --!><p>x</p>')).toBe('<p>x</p>');
		expect(without_comments('<!--><p>x</p>')).toBe('<p>x</p>');
		expect(without_comments('<!---><p>x</p>')).toBe('<p>x</p>');
	});

	it('a `<!--` inside a script or a quoted value is not a comment', () => {
		expect(without_comments('<script>s="<!--"</script><p>y</p><!--z-->')).toBe(
			'<script>s="<!--"</script><p>y</p>'
		);
		expect(without_comments('<a title="<!--">y</a><!--z-->')).toBe('<a title="<!--">y</a>');
	});

	it('an unclosed comment runs to the end', () => {
		expect(without_comments('a<!-- open')).toBe('a');
	});
});
