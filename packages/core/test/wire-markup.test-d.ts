/* Type-level guard for `MARK` (#479): a key it does not declare is a compile error, so a typo
 * cannot reach a page. tsc-only (no runtime). */
import { MARK, type Mark, type MarkKey } from '../src/wire-markup.ts';

// accepted
const baked: Mark = MARK.baked;
const key: MarkKey = 'ogygiaSpeculateHint';
void baked;
void key;

// @ts-expect-error: `typo` is not a declared marker
void MARK.typo;

// @ts-expect-error: a key outside the table is not a MarkKey
const stray: MarkKey = 'bakd';
void stray;
