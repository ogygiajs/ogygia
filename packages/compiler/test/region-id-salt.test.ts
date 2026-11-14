// A region id is hashed from its identity and, in production, the app's secret (`idSalt`), so ids
// cannot be computed offline (P1-ID). Both host kinds must salt: a `.svelte` host's region import
// and a `.ts` module's marked named import. The id is checked against `regionId(identity, salt)` itself.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import { transformHost, transformTsRegions } from '../src/region/transform.ts';
import { regionId } from '../src/region/identity.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
function ctx(idSalt?: string): Ctx {
	return {
		...HOST_CTX_DEFAULTS,
		idSalt,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		pathModule: path
	} as Ctx;
}

const SVELTE_HOST = dedent`
	<script>
	import Counter from '$lib/Counter.svelte' with { wake: 'load' };
	</script>
	<Counter />
`;

const TS_HOST = dedent`
	import { Counter as C } from '$lib/Counter.svelte' with { wake: 'load' };
	export { C };
`;

const HOSTS = [
	[
		'a .svelte host',
		(s?: string) => transformHost(SVELTE_HOST, '/app/src/routes/+page.svelte', ctx(s))
	],
	['a .ts host', (s?: string) => transformTsRegions(TS_HOST, '/app/src/lib/regions.ts', ctx(s))]
] as const;

describe('a region id is salted with idSalt', () => {
	it.each(HOSTS)('%s', (_name, compile) => {
		const plain = compile(undefined)!.islands[0];
		const salted = compile('s3cret')!.islands[0];
		expect(plain.identity).toBe(salted.identity);
		expect(plain.id).toBe(regionId(plain.identity!));
		expect(salted.id).toBe(regionId(salted.identity!, 's3cret'));
		expect(salted.id).not.toBe(plain.id);
		// the salted id is what the entry is named after, too
		expect(salted.virtualPath).toBe(`ogygia:region/entry/${salted.id}.js`);
	});

	it.each(HOSTS)('%s: an empty salt is no salt', (_name, compile) => {
		expect(compile('')!.islands[0].id).toBe(compile(undefined)!.islands[0].id);
	});
});
