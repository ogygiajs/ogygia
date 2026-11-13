import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type KitConfig, type KitDirs, DEFAULT_KIT_DIRS } from '../compiler/kit.ts';
import { warn } from '../compiler/messages.ts';

const CONFIG_FILES = ['svelte.config.js', 'svelte.config.mjs'];

type KitOptions = { files?: { routes?: string }; outDir?: string; inlineStyleThreshold?: number };

type PluginOption = unknown;

async function flatten_plugins(option: PluginOption): Promise<{ name?: string; api?: unknown }[]> {
	const out: { name?: string; api?: unknown }[] = [];
	const walk = async (p: unknown): Promise<void> => {
		const v = await p;
		if (!v) return;
		if (Array.isArray(v)) for (const x of v) await walk(x);
		else if (typeof v === 'object') out.push(v as { name?: string; api?: unknown });
	};
	await walk(option);
	return out;
}

async function kit_options_from_plugins(plugins: PluginOption): Promise<KitOptions | null> {
	const setup = (await flatten_plugins(plugins)).find(
		(p) => p.name === 'vite-plugin-sveltekit-setup'
	);
	const options = (setup?.api as { options?: KitOptions & { kit?: KitOptions } } | undefined)
		?.options;
	if (!options) return null;
	return options.kit ?? options;
}

async function kit_options_from_file(root: string): Promise<KitOptions | null> {
	const file = CONFIG_FILES.map((f) => path.join(root, f)).find((f) => existsSync(f));
	if (!file) return null;
	try {
		const mod = (await import(pathToFileURL(file).href)) as { default?: { kit?: KitOptions } };
		return mod.default?.kit ?? {};
	} catch (e) {
		warn('kit_config_unreadable', {
			file: path.relative(root, file),
			routes: DEFAULT_KIT_DIRS.routes,
			out: DEFAULT_KIT_DIRS.out,
			reason: e instanceof Error ? e.message : String(e)
		});
		return null;
	}
}

/** Read `root`'s Kit config (defaults when absent or unreadable): its dirs and inline-style
 *  threshold, for the plugin that asked to hold. `plugins`: the Vite config's plugin list. */
export async function load_kit_config(root: string, plugins?: PluginOption): Promise<KitConfig> {
	const kit: KitOptions =
		(await kit_options_from_plugins(plugins)) ?? (await kit_options_from_file(root)) ?? {};
	const dirs: KitDirs = {
		routes_dir: path.resolve(root, kit.files?.routes ?? DEFAULT_KIT_DIRS.routes),
		out_dir: path.resolve(root, kit.outDir ?? DEFAULT_KIT_DIRS.out)
	};
	const threshold = kit.inlineStyleThreshold;
	return {
		dirs,
		inline_style_threshold:
			typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0 ? threshold : 0
	};
}
