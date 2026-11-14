import { page_route_config, type Routes } from '../kit.ts';
import { dedent } from '@ogygia/core/contract';

/** One plugin's server realm, as the build wires it. */
export interface ServerRealm {
	/** the plugin's (package) name */
	name: string;
	/** the realm module's absolute POSIX path (the plugin's `server`) */
	module: string;
	/** the plugin's options (JSON) */
	options: unknown;
}

/** A plugin's browser realm, as the boot entry imports it. */
export interface ClientRealmFile {
	/** the plugin's (package) name */
	name: string;
	/** the realm module's absolute POSIX path (the plugin's `client`) */
	module: string;
}

/** The boot entry's plugin list (`[{ name, client }, …]`) and the imports it names, in plugin order. */
export function client_realms_source(clients: readonly ClientRealmFile[]): {
	imports: string;
	list: string;
} {
	if (!clients.length) return { imports: '', list: '' };
	return {
		imports: clients
			.map((c, i) => `import __og_client_${i} from ${JSON.stringify(c.module)};\n`)
			.join(''),
		list: `[${clients.map((c, i) => `{ name: ${JSON.stringify(c.name)}, client: __og_client_${i} }`).join(', ')}]`
	};
}

/**
 * `server-plugins` — SERVER only: each plugin's server half, one static import per plugin, in the
 * order the app listed them. The handle runs their stages straight off this list; an app with no
 * plugins gets an empty one (and the client always does).
 */
export function server_plugins_module(ssr: boolean, realms: readonly ServerRealm[]): string {
	if (!ssr || realms.length === 0) return `export const plugins = [];`;
	const imports = realms.map((r, i) => `import p${i} from ${JSON.stringify(r.module)};`).join('\n');
	const list = realms
		.map(
			(r, i) =>
				`{ name: ${JSON.stringify(r.name)}, options: ${JSON.stringify(r.options)}, server: p${i} }`
		)
		.join(',\n\t');
	return dedent`
		${imports}

		export const plugins = [
			${list}
		];
	`;
}

/** `route-config` — SERVER only: every Kit page route id → the keys the plugins claim inside Kit's
 *  `config` page option, merged the way Kit merges it (a key no level sets is absent). Empty on the
 *  client, and when no plugin claims a key: the route list never ships to the browser. */
export function route_config_module(
	ssr: boolean,
	routes: Routes,
	routesDir: string,
	keys: readonly string[]
): string {
	if (!ssr || keys.length === 0) return `export const route_config = {};`;
	return `export const route_config = ${JSON.stringify(page_route_config(routes, routesDir, keys))};`;
}
