// The runtime chunk's filename hash is computed from source content, not from the client build's
// output: Kit builds the server bundle before the client, so both builds must reach the same name on
// their own. Any change to any runtime file moves it; a missing input changes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { content_hash, runtime_inputs, RUNTIME_HASH } from '../src/vite/paths.ts';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'og-rt-'));

describe('the runtime hash', () => {
	it('is the content hash of its inputs, the same however often it is computed', () => {
		expect(RUNTIME_HASH).toMatch(/^[0-9a-f]{12}$/);
		expect(content_hash(runtime_inputs())).toBe(RUNTIME_HASH);
	});

	it('takes in every .js file of the runtime directory, and nothing else there', () => {
		const d = dir();
		fs.writeFileSync(path.join(d, 'a.js'), '1');
		fs.writeFileSync(path.join(d, 'b.js'), '2');
		fs.writeFileSync(path.join(d, 'a.js.map'), '{}');
		const inputs = runtime_inputs(d);
		expect(inputs.filter((f) => f.startsWith(d)).sort()).toEqual([
			path.join(d, 'a.js'),
			path.join(d, 'b.js')
		]);
		expect(inputs.length).toBeGreaterThan(2);
	});

	it('an unbuilt runtime directory adds nothing', () => {
		const inputs = runtime_inputs(path.join(dir(), 'missing'));
		expect(inputs).toEqual(runtime_inputs(path.join(dir(), 'also-missing')));
	});

	it('moves when any input changes; a missing input changes nothing', () => {
		const d = dir();
		const a = path.join(d, 'a.js');
		fs.writeFileSync(a, 'one');
		const before = content_hash([a]);
		expect(content_hash([a, path.join(d, 'gone.js')])).toBe(before);
		fs.writeFileSync(a, 'two');
		expect(content_hash([a])).not.toBe(before);
	});
});
