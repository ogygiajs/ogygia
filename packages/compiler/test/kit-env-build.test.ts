// KIT-PUBLIC-ENV: the build's identity on Kit's env channel. The server module and the browser's
// reader carry the same one for one app, so the reader takes its own server's env; another app (a
// federated peer) has another, so its reader never takes the host's env as its own.
import { describe, expect, it } from 'vitest';
import { memory_fs } from '../src/fs.ts';
import { kit_env_build, kit_env_reader_module, kit_public_env_module } from '../src/kit-patches.ts';

const PAGE = '<h1>home</h1>\n';

const app = (
	root: string,
	name: string | null,
	{
		base = '',
		app_dir = '_app',
		files = { 'src/routes/+page.svelte': PAGE } as Record<string, string>
	} = {}
) => {
	const all: Record<string, string> = {};
	if (name !== null) all[`${root}/package.json`] = JSON.stringify({ name });
	for (const [rel, text] of Object.entries(files)) all[`${root}/${rel}`] = text;
	return { root, base, app_dir, routes_dir: `${root}/src/routes`, fs: memory_fs(all) };
};

describe("the build's identity on Kit's env channel (KIT-PUBLIC-ENV)", () => {
	it('is the same in the server module and the browser reader of one app', () => {
		const build = kit_env_build(app('/srv/host', 'host-app'));
		expect(kit_public_env_module(3, build)).toContain(`kit_env_build = ${JSON.stringify(build)}`);
		expect(kit_public_env_module(null, build)).toContain(
			`kit_env_build = ${JSON.stringify(build)}`
		);
		expect(kit_env_reader_module('/rt/kit-env.js', build)).toContain(
			`read(${JSON.stringify(build)})`
		);
	});

	it('differs for another app: another name, base or app dir', () => {
		const host = kit_env_build(app('/app', 'host-app'));
		expect(kit_env_build(app('/app', 'peer-app'))).not.toBe(host);
		expect(kit_env_build(app('/app', 'host-app', { base: '/peer' }))).not.toBe(host);
		expect(kit_env_build(app('/app', 'host-app', { app_dir: '_peer' }))).not.toBe(host);
	});

	it('differs for two apps with the same name, base and app dir but other source', () => {
		const host = kit_env_build(app('/a/web', 'my-app'));
		const other_page = { 'src/routes/+page.svelte': '<h1>peer</h1>\n' };
		const other_lib = { 'src/routes/+page.svelte': PAGE, 'src/lib/nav.svelte': '<nav></nav>\n' };
		const other_route = { 'src/routes/+page.svelte': PAGE, 'src/routes/b/+page.svelte': PAGE };
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_page }))).not.toBe(host);
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_lib }))).not.toBe(host);
		expect(kit_env_build(app('/b/web', 'my-app', { files: other_route }))).not.toBe(host);
	});

	it('differs for two apps with no package.json and the same source in folders of one name', () => {
		const host = kit_env_build(app('/a/web', null));
		const other = { 'src/routes/+page.svelte': '<h1>peer</h1>\n' };
		expect(kit_env_build(app('/b/web', null, { files: other }))).not.toBe(host);
	});

	it('holds no path: one app built from another folder has the same identity', () => {
		expect(kit_env_build(app('/a/one', 'host-app'))).toBe(kit_env_build(app('/b/two', 'host-app')));
	});

	it("is the same with or without ogygia's keep-client route and other dot files in the source", () => {
		const host = kit_env_build(app('/a/web', 'my-app'));
		const with_dots = {
			'src/routes/+page.svelte': PAGE,
			'src/routes/.ogygia-keep-client/+layout.ts': 'export const csr = true;\n',
			'src/.DS_Store': 'x'
		};
		expect(kit_env_build(app('/a/web', 'my-app', { files: with_dots }))).toBe(host);
	});

	it('reads the routes where Kit is told they are, outside src too', () => {
		const at = (page: string) => {
			const a = app('/a/web', 'my-app', { files: { 'pages/+page.svelte': page } });
			return kit_env_build({ ...a, routes_dir: '/a/web/pages' });
		};
		expect(at(PAGE)).not.toBe(at('<h1>peer</h1>\n'));
	});
});
