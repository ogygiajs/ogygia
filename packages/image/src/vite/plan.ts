/**
 * COMPILE: one image file → its source plan (id, shown size, format, whether it moves, its
 * placeholder). No file is encoded here: pages ask for those at render, and the image endpoint makes
 * them. The id names the source's bytes alone (../source-id.ts `source_id`), so whoever makes a file can
 * check its original against it. The plan is kept in the build cache by the id and the source's
 * options, so a warm build or a dev restart reads no pixels it already measured.
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { BuildCache } from '@ogygia/compiler';
import type { Metadata } from 'sharp';
import type { ImageFormat, ImageOps } from '../descriptor.ts';
import { OgygiaError } from '../messages.ts';
import { source_id } from '../source-id.ts';
import { pixels } from './encoder.ts';
import type { ImageOptions, ImagePluginOptions } from './options.ts';

/** What a source file is. */
export interface Plan {
	id: string;
	width: number;
	height: number;
	format: ImageFormat;
	animated: boolean;
	ph?: string;
}

/** The settings one source is planned with: its own options over the plugin's. */
export interface Settings {
	placeholder: boolean;
	quality?: number;
	ops: ImageOps;
}

/** One source's settings: its options over the plugin's defaults. */
export function settle(plugin: ImagePluginOptions, own: ImageOptions): Settings {
	return {
		placeholder: own.placeholder ?? plugin.placeholder ?? true,
		...(own.quality !== undefined ? { quality: own.quality } : {}),
		ops: own.ops ?? {}
	};
}

const plans = new BuildCache<Plan>('image');

/** Bump when a plan (size, placeholder) changes for the same source: every kept plan is made again.
 *  test/encode-settings.test.ts holds what each version asks sharp for. */
export const PLAN_VERSION = 3;

const VECTOR_RE = /\.svg$/i;
const FORMAT_OF: Readonly<Record<string, ImageFormat>> = {
	jpeg: 'jpeg',
	jpg: 'jpeg',
	png: 'png',
	webp: 'webp',
	gif: 'gif',
	heif: 'avif',
	avif: 'avif',
	svg: 'svg',
	tiff: 'tiff'
};

function digest(parts: readonly (string | Uint8Array)[]): string {
	const h = crypto.createHash('sha256');
	for (const p of parts) {
		h.update(p);
		h.update('\0');
	}
	return h.digest('base64url').slice(0, 16);
}

function decode_failed(file: string, e: unknown): Error {
	return new OgygiaError('image_decode_failed', { file, reason: (e as Error).message });
}

/** Plan one file: read it once, measure it, make its placeholder. Kept by id and settings. */
export async function plan_image(file: string, settings: Settings): Promise<Plan> {
	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(file);
	} catch {
		throw new OgygiaError('image_not_found', { file, src: file });
	}
	const { metadata_of, placeholder_of, shown_size, too_large, VIPS_VERSION } = await pixels();
	const id = await source_id(bytes);
	const key = digest([id, JSON.stringify({ ...settings, plan: PLAN_VERSION, vips: VIPS_VERSION })]);
	const kept = plans.get(key);
	if (kept) return kept;

	let meta: Metadata;
	try {
		meta = await metadata_of(bytes);
	} catch (e) {
		throw decode_failed(file, e);
	}
	const why = VECTOR_RE.test(file) ? null : too_large(meta);
	if (why !== null) throw new OgygiaError('image_too_large', { file, reason: why });
	if (VECTOR_RE.test(file)) {
		const plan: Plan = {
			id,
			width: meta.width,
			height: meta.height,
			format: 'svg',
			animated: false
		};
		plans.set(key, plan);
		return plan;
	}
	const animated = (meta.pages ?? 1) > 1;
	const size = shown_size(meta, settings.ops, animated);
	const ph = settings.placeholder
		? await placeholder_of(bytes, settings.ops, size).catch((e: unknown) => {
				throw decode_failed(file, e);
			})
		: undefined;
	const plan: Plan = {
		id,
		width: size.width,
		height: size.height,
		format: FORMAT_OF[meta.format ?? ''] ?? 'png',
		animated,
		...(ph ? { ph } : {})
	};
	plans.set(key, plan);
	return plan;
}
