/**
 * Imported at the top of every test file while the recorder is on (record.ts): when the file's
 * tests end, what its functions recorded goes to `ABAX_RECORD_OUT` (one sample file per test file)
 * and the recorder starts empty for the next file in the same process.
 */
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { recorder } from '@bench/abax/recorder';

let n = 0;

afterAll(() => {
	const out = process.env.ABAX_RECORD_OUT;
	if (!out || recorder.records().length === 0) return;
	const name = `${process.pid}-${++n}-${Math.random().toString(36).slice(2, 8)}.bin`;
	recorder.save(join(out, name));
	recorder.reset();
});
