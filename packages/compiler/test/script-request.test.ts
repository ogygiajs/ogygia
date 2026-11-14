// Is a module id a request for the module's script? Only the query decides: a component's extracted
// style (`?svelte&type=style&lang.css`) and Vite's `?raw` / `?url` / `?inline` / `?worker` are not its
// code, and a pass that took them for it ran the Svelte parser over CSS and warned for every styled
// component. A cache query or ogygia's own is still the script.
import { describe, expect, it } from 'vitest';
import { is_script_request } from '../src/script-request.ts';

describe('is_script_request', () => {
	it.each([
		['/a/Foo.svelte', true],
		['/a/Foo.svelte?v=123', true],
		['/a/Foo.svelte?t=1&og-region', true],
		['/a/Foo.svelte?svelte&type=script&lang.ts', true],
		['/a/Foo.svelte?svelte&type=style&lang.css', false],
		['/a/Foo.svelte?svelte&type=style', false],
		['/a/Foo.svelte?svelte&lang.css', false],
		['/a/Foo.svelte?lang.mts', true],
		['/a/x.ts?raw', false],
		['/a/x.ts?url', false],
		['/a/x.ts?inline', false],
		['/a/x.ts?worker', false],
		['/a/x.ts?sharedworker', false],
		['/a/x.ts?direct', false],
		['/a/x.ts?v=1#&raw', true],
		['/a/x.ts?raw=1', false]
	])('%s → %s', (id, want) => {
		expect(is_script_request(id)).toBe(want);
	});
});
