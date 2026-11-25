/**
 * What `<Img>` asks of the plugin at render: a preset by name, and a file's URL. The server realm
 * names every file: in a prerender, each is a file the build makes; on a live server or in dev, a
 * preset the source was warmed with names the static files the build made, any other file the
 * encoder's own link (`virtual:ogygia-image/namer`), else a signed URL. In the browser nothing can
 * sign: a warmed preset names the build's files, a file with a link its link, and any other render
 * that only happens there shows the original file. An island keeps the server's URLs
 * (`<Img>` reads them back from the page).
 *
 * @packageDocumentation
 */
import config from 'virtual:ogygia-image/config';
import { name } from 'virtual:ogygia-image/namer';
import type { ImagePreset } from './config.ts';
import type { ImageDescriptor } from './descriptor.ts';
import { lay_out, preset_request, same_files, type Laid, type LayoutRequest } from './layout.ts';
import { built_url, mint, type Recipe } from './recipe.ts';
import { RenderError } from './render-messages.ts';

const NONE: ImagePreset = {};

/** The preset `image({ presets })` names `name`, or none when no name is given. */
export function preset_of(name: string | undefined): ImagePreset {
	if (name === undefined) return NONE;
	const p = config.presets[name];
	if (p) return p;
	throw new RenderError('image_preset_unknown', {
		preset: name,
		known: Object.keys(config.presets).join(', ') || '(none)'
	});
}

/** The URL of one file; `built` when the build made it (a warmed preset's). */
export function file_url(recipe: Recipe, built: boolean): string {
	const url = mint(recipe, built);
	if (url !== null) return url;
	if (built) return built_url(config.paths, recipe);
	const link = name(recipe);
	if (link !== null) return link;
	if (typeof window === 'undefined') throw new RenderError('image_no_server');
	return recipe.src;
}

/** What {@link getImage} takes: a preset by name, and anything to say over it. */
export interface GetImageOptions extends LayoutRequest {
	preset?: string;
}

/**
 * Lay out an image outside `<Img>` (a CSS background, an `og:image`, a hand-written `<picture>`): the
 * same files, signed URLs and attributes `<Img>` would render, from a preset or a layout. On the
 * server only, like `<Img>`'s own render.
 */
export function getImage(of: ImageDescriptor, request: GetImageOptions = {}): Laid {
	const { preset, ...own } = request;
	const p = preset_of(preset);
	const req = preset_request(p, own);
	const warmed =
		config.warmed &&
		preset !== undefined &&
		of.warm?.includes(preset) === true &&
		same_files(req, preset_request(p));
	return lay_out(of, req, config, (recipe) => file_url(recipe, warmed));
}
