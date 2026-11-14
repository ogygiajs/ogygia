import { expect, test } from 'vitest';
import { normalize_hashes, normalized_with_hashes } from './_normalize-hashes.ts';

const PAGE =
	'<!--rtd3wb--><ogygia-region data-og-fp="e6235853852c0768"><ogygia-slot data-og-slot="ogsrnm90-1"></ogygia-slot></ogygia-region><!--irnb2z--><script data-ogygia-props="e6235853852c0768">["snippet","se9de2e38b5c3313b","slot:ogabcdef-srnm90-2"]</script><!--rtd3wb--><b data-og-hole="6c88c728d5741256">propsBytes 145</b>';

test('the same input gives the same placeholders', () => {
	expect(normalize_hashes(PAGE)).toBe(normalize_hashes(PAGE));
});

test('each hash gets a placeholder numbered by its first appearance, and the same hash the same one', () => {
	expect(normalize_hashes(PAGE)).toBe(
		'<!--<id1>--><ogygia-region data-og-fp="<fp1>"><ogygia-slot data-og-slot="og<id2>-1"></ogygia-slot></ogygia-region><!--<id3>--><script data-ogygia-props="<fp1>">["snippet","s<snip1>","slot:ogabcdef-<id2>-2"]</script><!--<id1>--><b data-og-hole="<fp2>">propsBytes 145</b>'
	);
});

test('each placeholder is said with the hash it stands for, in the order they were numbered', () => {
	expect(
		normalized_with_hashes('a="0123456789abcdef" <!--rtd3wb--> c="0123456789abcdef"').hashes
	).toEqual(['<fp1>=0123456789abcdef', '<id1>=rtd3wb']);
});

test('different hashes get different numbers', () => {
	const two = normalize_hashes('a="0123456789abcdef" b="fedcba9876543210" c="0123456789abcdef"');
	expect(two).toBe('a="<fp1>" b="<fp2>" c="<fp1>"');
});

test("Svelte's block markers, a slot's own sequence prefix and the bytes around a hash stay as they are", () => {
	const markers = '<!--[--><!--[0--><!--[-1--><!--]--><!----><!-- head -->';
	expect(normalize_hashes(markers)).toBe(markers);
	expect(normalize_hashes('data-og-slot=\\"ogabcdef-srnm90-1\\"')).toBe(
		'data-og-slot=\\"ogabcdef-<id1>-1\\"'
	);
});
