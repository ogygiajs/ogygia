// KIT-PUBLIC-ENV: the build's identity on Kit's env channel. The server module and the browser's
// reader carry the same one for one app, so the reader takes its own server's env; another app (a
// federated peer) has another, so its reader never takes the host's env as its own.
import { describe, expect, it } from 'vitest';
import { memory_fs } from '../src/fs.ts';
import { kit_env_build, kit_env_reader_module, kit_public_env_module } from '../src/kit-patches.ts';

const app = (root: string, name: string | null, base = '', app_dir = '_app') => ({
	root,
	base,
	app_dir,
	fs: memory_fs(name === null ? {} : { [`${root}/package.json`]: JSON.stringify({ name }) })
});

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
		expect(kit_env_build(app('/app', 'host-app', '/peer'))).not.toBe(host);
		expect(kit_env_build(app('/app', 'host-app', '', '_peer'))).not.toBe(host);
	});

	it('holds no path: one app built from another folder has the same identity', () => {
		expect(kit_env_build(app('/a/one', 'host-app'))).toBe(kit_env_build(app('/b/two', 'host-app')));
	});

	it("a package.json that does not parse: the root's folder names the app", () => {
		const broken = { ...app('/a/host', null), fs: memory_fs({ '/a/host/package.json': '{ name' }) };
		expect(kit_env_build(broken)).toBe(kit_env_build(app('/b/host', null)));
	});

	it("an app with no package name is named by its root's folder", () => {
		expect(kit_env_build(app('/a/host', null))).not.toBe(kit_env_build(app('/a/peer', null)));
		expect(kit_env_build(app('/a/host', null))).toBe(kit_env_build(app('/b/host', null)));
	});
});
