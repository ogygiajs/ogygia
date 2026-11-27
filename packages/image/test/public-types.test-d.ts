/* Type-level guard: an app names the types of an `art` list and of a preload from the public entry.
 * tsc-only (no runtime). */
import {
	getImage,
	type ImageDescriptor,
	type Laid,
	type LaidPreload,
	type LaidSource,
	type Twin
} from '../src/index.ts';

declare const hero: ImageDescriptor;
declare const hero_tall: ImageDescriptor;

const art: Twin[] = [
	{ media: '(max-width: 600px)', aspect: '4/5', position: 'attention' },
	{ media: '(min-width: 1600px)', of: hero_tall, width: 1600 }
];
const laid: Laid = getImage(hero, { preset: 'hero', art });
const preloads: LaidPreload[] = laid.preloads;
const first: LaidPreload | undefined = preloads[0];
const href: string | undefined = first?.href;
const sources: LaidSource[] = laid.sources;
void href;
void sources;

// @ts-expect-error a twin names the media condition it answers
const no_media: Twin = { aspect: '1/1' };
void no_media;
