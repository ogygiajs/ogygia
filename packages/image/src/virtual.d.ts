declare module 'virtual:ogygia-image/config' {
	const config: import('./config.ts').RenderConfig;
	export default config;
}

declare module 'virtual:ogygia-image/sources' {
	/** Every image under `src/`, by its project path: its asset URL. */
	const sources: Record<string, string>;
	export default sources;
	/** The name of every remote image the server build fetched (a list, written at the end of the
	 *  build); in dev, a placeholder string. */
	export const remote: readonly string[] | string;
}

declare module 'virtual:ogygia-image/maker' {
	export const parallel: import('./maker.ts').Maker['parallel'];
	export const make: import('./maker.ts').Maker['make'];
	export const store: import('./maker.ts').Maker['store'];
	export const fit: import('./maker.ts').Maker['fit'];
}

declare module 'virtual:ogygia-image/remote' {
	/** The app's `image({ remote })`, its defaults filled in, or null. */
	export const remote: import('./remote-fetch.ts').RemoteConfig | null;
	/** Loads how the endpoint sends a remote request in this runtime, or null. */
	export const transport: (() => Promise<import('./remote-fetch.ts').Transport>) | null;
}

declare module 'virtual:ogygia-image/cards' {
	/** Whether this server draws cards. */
	export const engine: boolean;
	/** The card named `name`, or null. */
	export function card_module(name: string): Promise<import('./cards/read.ts').CardModule | null>;
}

declare module 'virtual:ogygia-image/theme.css' {}

declare module 'virtual:ogygia-image/namer' {
	export const name: import('./recipe.ts').Namer;
}

declare module '$app/server' {
	export function read(asset: string): Response;
}

declare module '$app/environment' {
	export const building: boolean;
}
