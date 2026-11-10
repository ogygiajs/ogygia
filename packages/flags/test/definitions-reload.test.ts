// A FLAG REMOVED FROM A MODULE IS GONE AFTER THAT MODULE'S DEV RELOAD (#413). flag() is a definer
// core marks with its module's run in dev (`b.definers('@ogygia/flags', ['flag'])`): the module's
// next run ends the definitions its last run made, so a source is never asked for a flag the code
// no longer defines, and a layer never keeps a member that is gone.
import { afterEach, describe, expect, it } from 'vitest';
import { defineRun } from '@ogygia/machine';
import { decide, flag, prime_flags } from '../src/index.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server from '../src/server.ts';

startPlugin(server, { name: '@ogygia/flags' });

afterEach(() => {
	decide({ source: undefined });
});

const ctx = (path: string) => {
	const url = 'http://s' + path;
	return { request: new Request(url), url: new URL(url), cookies: { get: () => undefined } };
};

/** The flag names the source is asked for on a request. */
async function asked(path: string): Promise<string[]> {
	let names: string[] = [];
	decide({
		source: (flags) => {
			names = flags.map((f) => f.name);
			return {};
		}
	});
	await prime_flags(ctx(path));
	return names;
}

describe('flags defined by a module, across its dev reloads', () => {
	it('a flag removed from the module is gone after its reload; a kept one stays', async () => {
		const module = '/app/src/lib/flags.ts';
		const first = defineRun(module);
		first(flag)('reload-kept', 50);
		first(flag)('reload-removed', 50);
		expect(await asked('/a')).toEqual(expect.arrayContaining(['reload-kept', 'reload-removed']));
		// the module is edited: its new run defines only one of them
		const second = defineRun(module);
		second(flag)('reload-kept', 50);
		const now = await asked('/b');
		expect(now).toContain('reload-kept');
		expect(now).not.toContain('reload-removed');
	});

	it("another module's reload keeps this module's flags", async () => {
		defineRun('/app/src/lib/one.ts')(flag)('reload-one', 50);
		defineRun('/app/src/lib/two.ts')(flag)('reload-two', 50);
		defineRun('/app/src/lib/two.ts');
		const now = await asked('/c');
		expect(now).toContain('reload-one');
		expect(now).not.toContain('reload-two');
	});
});
