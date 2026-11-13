/**
 * `flags()` — the flags plugin, listed beside `ogygia()` in vite.config `plugins`. Turns on the
 * per-request source priming and exposure flushing (its server realm); `flag()` itself works without
 * it (native, sticky decisions), but a `decide({ source, exposure })` needs it. A `vite build` with
 * it writes the flag inventory to `node_modules/.ogygia/flags-manifest.json` (./inventory.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { definePlugin, type OgygiaPlugin, type PrescanHook } from '@ogygia/compiler/vite';
import { line } from './build-messages.ts';
import { collect_flag_sites, flags_manifest, FLAGS_SPEC, type FlagSite } from './inventory.ts';

export function flags(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/flags',
		server: import.meta.resolve('./server.ts'),
		build(b) {
			// each flag() call is owned by the run of the module that makes it (dev: core marks it), so
			// a flag deleted from the code leaves when its module reloads
			b.definers('@ogygia/flags', ['flag']);
			b.prescan(inventory(b.root));
		}
	});
}

/** One build's flag inventory: the flag sites of every module the prescan reads, written once the
 *  client output is (both legs prescan: the manifest dedupes). */
function inventory(root: string): PrescanHook {
	const sites: FlagSite[] = [];
	return {
		imports: [FLAGS_SPEC],
		module({ file, rel, code }) {
			sites.push(...collect_flag_sites(code, file, rel));
		},
		written() {
			if (!sites.length) return;
			try {
				const dir = path.join(root, 'node_modules', '.ogygia');
				fs.mkdirSync(dir, { recursive: true });
				const manifest = flags_manifest(sites);
				fs.writeFileSync(
					path.join(dir, 'flags-manifest.json'),
					`${JSON.stringify(manifest, null, '\t')}\n`
				);
				console.log(line('flags_manifest_written', { count: manifest.names.length }));
			} catch {
				// ok: a read-only file system never fails the build over an inventory
			}
		}
	};
}
