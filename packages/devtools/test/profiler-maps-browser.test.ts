// The profiler's maps in the browser (src/profiler/maps-browser.ts): the server build's, so none.
import { expect, it } from 'vitest';
import { read_profiler_maps } from '../src/profiler/maps-browser.ts';

it('reads no profiler maps in the browser', async () => {
	expect(await read_profiler_maps()).toBeNull();
});
