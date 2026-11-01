/**
 * Builds every font file the docs site ships, into src/lib/fonts/ (committed: the site build never
 * runs this). Each face is cut to the latin `unicode-range` its @font-face declares, its variable
 * axes narrowed to the weights the site uses, its hinting dropped (the fontsource faces already ship
 * unhinted) and its OpenType features cut to the ones that shape text by default plus `tnum`
 * (`font-variant-numeric: tabular-nums`). Re-run after bumping a source package:
 *
 *   pnpm --filter docs fonts
 *
 * Geist Serif has ONE weight (400) and no italic: its only axis in the VF file is a decorative
 * element-shape one, so the static Regular is the source. It is also written as `.woff` for the OG
 * card renderer (satori reads woff / ttf / otf, never woff2).
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import subsetFont from 'subset-font';

/** The latin range every @font-face in src/fonts.css and src/fonts-mono.css declares. */
const LATIN =
	'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, ' +
	'U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** Default-on shaping features (kerning, marks, ligatures, contextual alternates) and `tnum`. */
const FEATURES = [
	'ccmp',
	'locl',
	'mark',
	'mkmk',
	'kern',
	'liga',
	'clig',
	'calt',
	'rlig',
	'rclt',
	'tnum'
];

type Axis = { min: number; max: number; default: number };
type Face = {
	source: string;
	license: string;
	out: string;
	formats: ('woff2' | 'woff')[];
	axes?: Record<string, Axis>;
};

const modules = new URL('../node_modules/', import.meta.url);
const out_dir = new URL('../src/lib/fonts/', import.meta.url);

const faces: Face[] = [
	{
		source: 'geist/dist/fonts/geist-serif/GeistSerif-Regular.woff2',
		license: 'geist/LICENSE.txt',
		out: 'geist-serif-latin',
		formats: ['woff2', 'woff']
	},
	{
		source: '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2',
		license: '@fontsource-variable/instrument-sans/LICENSE',
		out: 'instrument-sans-latin-wght',
		formats: ['woff2'],
		axes: { wght: { min: 400, max: 700, default: 400 } }
	},
	{
		source: '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
		license: '@fontsource-variable/jetbrains-mono/LICENSE',
		out: 'jetbrains-mono-latin-wght',
		formats: ['woff2'],
		axes: { wght: { min: 400, max: 700, default: 400 } }
	}
];

/** `U+0000-00FF, U+0131, …` → every code point in it, as a string. */
function text_of(range: string) {
	let text = '';
	for (const part of range.split(',')) {
		const [from, to = from] = part.trim().slice(2).split('-');
		for (let c = parseInt(from, 16); c <= parseInt(to, 16); c++) text += String.fromCodePoint(c);
	}
	return text;
}

const text = text_of(LATIN);
await mkdir(out_dir, { recursive: true });

for (const face of faces) {
	const source = await readFile(new URL(face.source, modules));
	for (const format of face.formats) {
		const subset = await subsetFont(source, text, {
			targetFormat: format,
			variationAxes: face.axes,
			keepFeatures: FEATURES,
			noHinting: true
		});
		const file = `${face.out}.${format}`;
		await writeFile(new URL(file, out_dir), subset);
		console.log(`${file.padEnd(34)} ${String(source.length).padStart(6)} → ${subset.length} B`);
	}
	await copyFile(new URL(face.license, modules), new URL(`${face.out}.LICENSE.txt`, out_dir));
}
