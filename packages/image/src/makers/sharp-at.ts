/**
 * The sharp maker at one AVIF effort (`sharp({ effort: { avif } })`): what ./sharp.ts is at the
 * default, made by a function so an app's other effort opens its own store and nothing at the
 * default's.
 *
 * @packageDocumentation
 */
import os from 'node:os';
import { build_handoff } from '../handoff.ts';
import type { MadeStore, Maker } from '../maker.ts';
import { encode_recipe, VIPS_VERSION } from '../pixels.ts';
import { FileStore, runtime_store } from '../store.ts';

/** A sharp maker: its line's width, its make, and its store. */
export interface SharpMaker {
	parallel: number;
	make: Maker['make'];
	store: MadeStore | null;
}

/** The sharp maker that makes AVIF at `avif_effort`: half the machine's cores at once (one to four),
 *  its store the build cache's in the build and the dev server (the handoff's folder, already the
 *  effort's), else the live server's folder for that effort. */
export function sharp_maker(avif_effort: number): SharpMaker {
	const handoff = build_handoff();
	return {
		parallel: Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2))),
		make: (bytes, recipe) => encode_recipe(bytes, recipe, avif_effort),
		store: handoff
			? FileStore.shared(handoff.store)
			: runtime_store(VIPS_VERSION, os.tmpdir(), avif_effort)
	};
}
