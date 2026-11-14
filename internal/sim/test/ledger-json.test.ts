import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEDGER_FILES, parse_ledger, read_ledger_file } from '../src/ledger-json.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const MERGED_TWICE = `{
	"baseline": [],
	"equivalent": [{ "site": "a", "why": "main's" }],
	"covered": [],
	"equivalent": [{ "site": "b", "why": "the branch's" }]
}
`;

describe('a hand-merged ledger', () => {
	it('with a bucket key twice is refused, naming the file, the key and its line', () => {
		expect(() => parse_ledger(MERGED_TWICE, 'internal/sim/failures.json')).toThrow(
			'internal/sim/failures.json:5: the key "equivalent" is in this object twice'
		);
	});

	it('with a key twice in a nested object is refused at that line', () => {
		const text = '[\n\t{ "id": "m1", "code": "x" },\n\t{ "id": "m2",\n\t  "id": "m3" }\n]\n';
		expect(() => parse_ledger(text, 'mutants.json')).toThrow(
			'mutants.json:4: the key "id" is in this object twice'
		);
	});

	it('with a key written two ways that decode the same is refused', () => {
		expect(() => parse_ledger('{ "why": 1, "wh\\u0079": 2 }', 'x.json')).toThrow(
			'x.json:1: the key "why" is in this object twice'
		);
	});

	it('keeps the same key in sibling objects, and keys that only look alike inside strings', () => {
		const text =
			'{ "a": { "k": "\\"k\\": 1, {" }, "b": { "k": "}" }, "c": [{ "k": 1 }, { "k": 2 }] }';
		expect(parse_ledger(text, 'x.json')).toEqual(JSON.parse(text));
	});

	it('that is not JSON names its file', () => {
		expect(() => parse_ledger('{ "a": 1,, }', 'steps.json')).toThrow(/^steps\.json: /);
	});

	it.each(LEDGER_FILES)('%s in the tree has no key twice', (file) => {
		expect(() => read_ledger_file(ROOT + file)).not.toThrow();
	});
});
