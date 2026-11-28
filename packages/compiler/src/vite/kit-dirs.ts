import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type KitConfig, type KitDirs, type KitIdentity, DEFAULT_KIT_DIRS } from '../kit.ts';
import { warn } from '../messages.ts';

const CONFIG_FILES = ['svelte.config.js', 'svelte.config.mjs'];
const KIT_SETUP_PLUGIN = 'vite-plugin-sveltekit-setup';

type KitOptions = {
	files?: { routes?: string };
	outDir?: string;
	inlineStyleThreshold?: number;
	paths?: { base?: unknown; assets?: unknown };
	version?: { name?: unknown };
};

type PluginOption = unknown;

function kit_setup_options(p: { name?: string; api?: unknown } | undefined): KitOptions | null {
	if (p?.name !== KIT_SETUP_PLUGIN) return null;
	const options = (p.api as { options?: KitOptions & { kit?: KitOptions } } | undefined)?.options;
	if (!options) return null;
	return options.kit ?? options;
}

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
	for (const p of await flatten_plugins(plugins)) {
		const options = kit_setup_options(p);
		if (options) return options;
	}
	return null;
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

/** Kit's `paths.base`, `paths.assets` and `version.name` as Kit resolved them, off Kit's own setup plugin in
 *  `plugins`, the resolved config's final plugin list (so one another plugin adds is found too).
 *  Only that plugin holds them as Kit ships them: in a build Kit sets Vite's `base` to './', and its
 *  default `version.name` is the time its config loaded. With no such plugin, neither is read. */
export function kit_identity(
	plugins: readonly { name?: string; api?: unknown }[] | undefined
): KitIdentity {
	for (const p of plugins ?? []) {
		const kit = kit_setup_options(p);
		if (!kit) continue;
		const base = kit.paths?.base;
		const assets = kit.paths?.assets;
		const version = kit.version?.name;
		return {
			base: typeof base === 'string' ? base : '',
			assets: typeof assets === 'string' ? assets : '',
			version: typeof version === 'string' ? version : null
		};
	}
	return { base: '', assets: '', version: null };
}
