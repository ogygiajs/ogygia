declare module 'virtual:ogygia-image/config' {
	const config: import('./config.ts').RenderConfig;
	export default config;
}

declare module 'virtual:ogygia-image/sources' {
	/** Every image under `src/`, by its project path: its asset URL. */
	const sources: Record<string, string>;
	export default sources;
}

declare module 'virtual:ogygia-image/maker' {
	export const parallel: import('./maker.ts').Maker['parallel'];
	export const make: import('./maker.ts').Maker['make'];
	export const store: import('./maker.ts').Maker['store'];
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
