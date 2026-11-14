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

/** Parse a ledger's text; `file` names it in an error. */
export function parse_ledger(text: string, file: string): unknown {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
	}
}

/** Read and parse the ledger at `file`. */
export function read_ledger_file(file: string): unknown {
	return parse_ledger(readFileSync(file, 'utf8'), file);
}
