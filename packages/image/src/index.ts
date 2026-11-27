/**
 * `@ogygia/image`: the browser-safe half. `<Img>` renders a source descriptor; the plugin
 * (`@ogygia/image/vite`) makes descriptors from files at build, and its server half makes each file a
 * page asks for.
 *
 * @packageDocumentation
 */
export { default as Img } from './Img.svelte';
export {
	isImage,
	type ImageDescriptor,
	type ImageFormat,
	type ImageOps,
	type Twin
} from './descriptor.ts';
export type { ImageLayout, ImagePosition, ImagePreset, OutputFormat } from './config.ts';
export type { Laid, LaidPreload, LaidSource, LayoutRequest } from './layout.ts';
export { getImage, type GetImageOptions } from './render.ts';
export { remoteImage, type RemoteImageOptions } from './remote-image.ts';
