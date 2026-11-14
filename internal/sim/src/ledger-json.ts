/**
 * The one reader of the hand-merged JSON ledgers: internal/sim/failures.json, steps.json and
 * mutants.json, internal/compiler-dst/mutants.json and internal/heisenbench/unmeasured.json.
 */
import { readFileSync } from 'node:fs';

/** The ledgers people and git merge by hand, from the repository root. */
export const LEDGER_FILES: readonly string[] = [
	'internal/sim/failures.json',
	'internal/sim/steps.json',
	'internal/sim/mutants.json',
	'internal/compiler-dst/mutants.json',
	'internal/heisenbench/unmeasured.json'
];

/** Parse a ledger's text, refusing a key that is in one object twice (JSON.parse would keep the
 *  last and drop the first silently); `file` names it in an error. */
export function parse_ledger(text: string, file: string): unknown {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (e) {
		throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
	}
	refuse_duplicate_keys(text, file);
	return value;
}

function refuse_duplicate_keys(text: string, file: string): void {
	const open: (Set<string> | null)[] = [];
	let key_next = false;
	let line = 1;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\n') line++;
		else if (c === '{') {
			open.push(new Set());
			key_next = true;
		} else if (c === '[') {
			open.push(null);
			key_next = false;
		} else if (c === '}' || c === ']') {
			open.pop();
			key_next = false;
		} else if (c === ',') key_next = open.at(-1) != null;
		else if (c === '"') {
			let end = i + 1;
			while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
			const keys = open.at(-1);
			if (key_next && keys) {
				const key = JSON.parse(text.slice(i, end + 1)) as string;
				if (keys.has(key))
					throw new Error(
						`${file}:${line}: the key "${key}" is in this object twice. JSON.parse keeps only the last, so the first is lost: merge the two by hand.`
					);
				keys.add(key);
			}
			key_next = false;
			i = end;
		}
	}
}

/** Read and parse the ledger at `file`. */
export function read_ledger_file(file: string): unknown {
	return parse_ledger(readFileSync(file, 'utf8'), file);
}
