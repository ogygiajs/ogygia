// A REGION'S IDENTITY IS ITS COMPONENT, HOWEVER IT IS IMPORTED. The id joins every host that marks
// the same component the same way (region/identity.ts), so each way an app can name that file must
// give one id and one wrapper: `$lib/…`, a relative path, a root-absolute `/src/…` (Vite resolves it
// under the app root), an app alias; and a host whose script is `lang="ts"` beside one that is not.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { transformHost } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-identity-')));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const LIB = `${ROOT}/src/lib`;
mkdirSync(`${LIB}/widgets`, { recursive: true });
writeFileSync(`${LIB}/widgets/W.svelte`, '<p>w</p>\n');

const ctx = (ssr: boolean) =>
	({
		...HOST_CTX_DEFAULTS,
		ssr,
		root: ROOT,
		libDir: LIB,
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		alias: [{ find: '$widgets', replacement: `${LIB}/widgets` }]
	}) as Parameters<typeof transformHost>[2];

/** The one region a host marking `spec` registers, on `leg`. */
function region_of(host: string, spec: string, lang = '', ssr = true) {
	const src = dedent`
		<script${lang}>
		import W from '${spec}' with { wake: 'visible' };
		</script>
		<W />
	`;
	const out = transformHost(src, host, ctx(ssr));
	expect(out?.islands).toHaveLength(1);
	return out!.islands![0] as {
		id: string;
		componentPath: string;
		wrapperSource?: string;
		wrapperClientSource?: string;
	};
}

const PAGE = `${ROOT}/src/routes/+page.svelte`;
const LIB_HOST = `${LIB}/widgets/Card.svelte`;

describe('one component, one region id, however the host names it', () => {
	const by_lib = region_of(PAGE, '$lib/widgets/W.svelte');
	it.each([
		['a root-absolute path', PAGE, '/src/lib/widgets/W.svelte'],
		['a relative path', LIB_HOST, './W.svelte'],
		['an app alias', PAGE, '$widgets/W.svelte']
	])('%s', (_name, host, spec) => {
		const r = region_of(host, spec);
		expect(r.componentPath).toBe(`${LIB}/widgets/W.svelte`);
		expect(r.id).toBe(by_lib.id);
	});
});

describe("a lang='ts' host and a plain one share the region's wrapper, byte for byte", () => {
	it.each([true, false])('ssr %s', (ssr) => {
		const js = region_of(PAGE, '$lib/widgets/W.svelte', '', ssr);
		const ts = region_of(LIB_HOST, './W.svelte', ' lang="ts"', ssr);
		expect(ts.id).toBe(js.id);
		expect(ts.wrapperSource).toBe(js.wrapperSource);
		expect(ts.wrapperClientSource).toBe(js.wrapperClientSource);
	});
});
