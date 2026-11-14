import fs from 'node:fs';
import path from 'node:path';
import type { PrescanHook } from '@ogygia/compiler/vite';
import { line } from './build-messages.ts';
import { collect_flag_sites, flags_manifest, FLAGS_SPEC, type FlagSite } from './inventory.ts';

/** One build's flag inventory: the flag sites of every module the prescan reads, written once the
 *  client output is (both legs prescan: the manifest dedupes). */
export class Inventory implements PrescanHook {
	readonly imports: readonly string[] = [FLAGS_SPEC];
	readonly #root: string;
	readonly #sites: FlagSite[] = [];

	constructor(root: string) {
		this.#root = root;
	}

	module({
		file,
		rel,
		code
	}: {
		readonly file: string;
		readonly rel: string;
		readonly code: string;
	}): void {
		this.#sites.push(...collect_flag_sites(code, file, rel));
	}

	written(): void {
		const sites = this.#sites;
		if (!sites.length) return;
		try {
			const dir = path.join(this.#root, 'node_modules', '.ogygia');
			fs.mkdirSync(dir, { recursive: true });
			const manifest = flags_manifest(sites);
			fs.writeFileSync(
				path.join(dir, 'flags-manifest.json'),
				`${JSON.stringify(manifest, null, '\t')}\n`
			);
			console.log(line('flags_manifest_written', { count: manifest.names.length }));
			// oxlint-disable-next-line ogygia/no-silent-failures -- a read-only file system never fails the build over an inventory
		} catch {}
	}
}
