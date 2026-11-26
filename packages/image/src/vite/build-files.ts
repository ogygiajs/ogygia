/**
 * THE BUILD'S FILES. Pages ask for image files and the endpoint makes them; the files a page served
 * with no server needs are made by the build itself, all in one place: the server build's end, after
 * Kit's prerender and before the adapter. Two kinds, one store (../store.ts, in the build cache, so a
 * CI run that keeps the cache makes nothing twice), one name (../recipe.ts `built_file`: the recipe,
 * whose id names its source by content, so the same file in every build with no key):
 *
 * - WARMED: `import.meta.og.image(src, { warm: 'cover' })` asks for the `cover` preset's files, for a
 *   page rendered on a live server. Every source the server build read with `warm` is listed.
 * - PRERENDERED: every file a prerendered page names. The server realm notes each recipe on disk
 *   (Kit's prerender runs in a worker) and tells the build, which starts it at once, and names it
 *   with the build's mark in front (Kit's crawler does not follow it: it would 404 a file under the
 *   app folder that is not there yet). A `remoteImage()` source is fetched here, under
 *   `image({ remote })` (./remote.ts), and its files are named by the bytes it got, not by its
 *   URL: every prerendered page's name of them is rewritten to that, so a URL whose bytes change
 *   gets new file names, never an old file kept forever under a new picture.
 *
 * One build makes each file once: every make, the prerender's head start and the build's end alike,
 * runs in the build's own thread as one flight per file, a few at once.
 *
 * Each file is written to the client output, under `<appDir>/immutable/og/`, which every adapter
 * serves as a file kept forever; then the mark is removed from every prerendered file, so its URLs
 * name those files, and a URL the page made absolute (`new URL(src, page.url)`: an `og:image`, a
 * feed) names them at Kit's prerender origin, which the server realm noted. One that cannot be made
 * fails the build (`image_unsettled`); a mark the page changed another way (escaped, encoded), or
 * made absolute with Kit's default origin, does too (`image_mark_left`).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildCache } from '@ogygia/compiler';
import { BroadcastChannel } from 'node:worker_threads';
import {
	clock,
	flights,
	queue,
	random,
	scope,
	STALE,
	type Place,
	type Queue,
	type Scope
} from '@ogygia/machine';
import type { RenderConfig } from '../config.ts';
import type { ImageDescriptor } from '../descriptor.ts';
import { lay_out, preset_request } from '../layout.ts';
import { OgygiaError } from '../messages.ts';
import { pixels } from './encoder.ts';
import {
	BUILT_DIR,
	built_file,
	built_url,
	card_of_tail,
	parse_recipe,
	recipe_file,
	remote_of_tail,
	type ParsedRecipe,
	type Recipe
} from '../recipe.ts';
import { build_handoff, BUILD_ENV, type BuildHandoff } from '../handoff.ts';
import { entry_for } from '../remote-hosts.ts';
import { source_id } from '../source-id.ts';
import { built_channel, FileStore, open_build_store, origin_of } from '../store.ts';

const PARALLEL = Math.max(1, Math.min(8, os.availableParallelism()));

const DAY_MS = 24 * 3600 * 1000;

function remove_old_runs(runs: string): void {
	const now = clock.wall();
	let names: string[];
	try {
		names = fs.readdirSync(runs);
		// oxlint-disable-next-line ogygia/no-silent-failures -- no runs folder yet: nothing was left
	} catch {
		return;
	}
	for (const name of names) {
		const run = path.join(runs, name);
		try {
			if (now - fs.statSync(run).mtimeMs > DAY_MS) fs.rmSync(run, { recursive: true, force: true });
			// oxlint-disable-next-line ogygia/no-silent-failures -- a run that could not be removed is tried again by the next build
		} catch {}
	}
}

/**
 * The handoff of this process's build or dev server, in the environment of the process and every
 * worker it starts: the store's folder and, for a build, the notes file of its prerender and its
 * mark (a random host: no page names it by chance). A build
 * keeps the one it started until its end removes the notes' folder (Kit and its plugins resolve the
 * config more than once in one build); a dev server or a preview takes any there is, or starts one
 * with no notes. Given Kit's build `output` (by the build's start, never by a config that Kit's
 * workers resolve for themselves), this thread starts each file the prerender notes as the note
 * comes, from the original in that output: one thread makes the build's files.
 */
export async function handoff_for(
	build: boolean,
	root: string = process.cwd(),
	output: string | null = null
): Promise<BuildHandoff> {
	const open = build_handoff();
	if (open && (!build || (open.minted && fs.existsSync(path.dirname(open.minted))))) {
		const rooted = open.root === root ? open : { ...open, root };
		if (rooted !== open) process.env[BUILD_ENV] = JSON.stringify(rooted);
		if (build && output !== null) BuildMakes.of(rooted, output);
		return rooted;
	}
	const cache = new BuildCache('image').dir() ?? fs.mkdtempSync(path.join(os.tmpdir(), 'og-img-'));
	let minted = '';
	let mark = '';
	if (build) {
		remove_old_runs(path.join(cache, 'runs'));
		const id = random.uuid();
		const run = path.join(cache, 'runs', id);
		fs.mkdirSync(run, { recursive: true });
		minted = path.join(run, 'minted.txt');
		mark = `//${id.replaceAll('-', '').slice(0, 16)}.ogygia.invalid`;
	}
	const handoff: BuildHandoff = {
		store: open_build_store(path.join(cache, 'files'), (await pixels()).VIPS_VERSION),
		minted,
		mark,
		written: '',
		root,
		remote: path.join(cache, 'remote')
	};
	process.env[BUILD_ENV] = JSON.stringify(handoff);
	if (build && output !== null) BuildMakes.of(handoff, output);
	return handoff;
}

/** One source a module warmed: its descriptor (no `src`: a built file is named by its recipe), its
 *  original file and the presets it was warmed with. */
export interface WarmSource {
	file: string;
	desc: Omit<ImageDescriptor, 'src'>;
	/** Each twin's original file, by its source id. */
	originals: Readonly<Record<string, string>>;
	presets: string[];
}

interface Turn {
	run: () => Promise<void>;
	gone: () => void;
}

function line_of(name: string, owner: Scope): Queue<Turn> {
	return queue<Turn>({
		name,
		max: PARALLEL,
		owner,
		start: (turn: Turn, place: Place) => {
			// oxlint-disable-next-line ogygia/no-silent-failures -- run() settles its caller's promise with the failure and never rejects itself
			void turn.run().finally(() => place.release());
		},
		stale: (turn: Turn) => turn.gone()
	});
}

function in_turn<T>(line: Queue<Turn>, work: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		line.push({
			run: () => work().then(resolve, reject),
			gone: () => reject(new Error('the build ended before its turn came'))
		});
	});
}

function noted_original(output: string, recipe: ParsedRecipe): Uint8Array {
	for (const side of ['client', 'server']) {
		const file = path.join(output, side, ...recipe.tail.split('/'));
		if (fs.existsSync(file)) return fs.readFileSync(file);
	}
	throw new Error(`its original ${recipe.tail} is not in the build output`);
}

interface Ask {
	key: string;
	recipe: Omit<Recipe, 'src'>;
	original: () => Uint8Array | Promise<Uint8Array>;
	card: boolean;
}

class BuildMakes {
	static #open = new Map<string, BuildMakes>();

	readonly #minted: string;
	readonly #store: FileStore;
	readonly #scope: Scope = scope();
	readonly #encodes: Queue<Turn> = line_of('image build encodes', this.#scope);
	readonly #writes: Queue<Turn> = line_of('image build writes', this.#scope);
	readonly #makes = flights.keyed<Ask>()<
		'key',
		'recipe' | 'original' | 'card',
		Promise<Uint8Array>
	>({
		name: 'image build files',
		key: ['key'],
		ignore: {
			recipe: 'the key is the recipe',
			original: 'the key names the source by content, and a make checks the original against it',
			card: "the key's id names a card's digest, size and props"
		},
		keep: 0,
		run: ({ key, recipe, original, card }: Ask): Promise<Uint8Array> =>
			in_turn(this.#encodes, () => made(this.#store, key, recipe, original, card))
	});

	private constructor(handoff: BuildHandoff, output: string) {
		this.#minted = handoff.minted;
		this.#store = FileStore.shared(handoff.store);
		const channel = new BroadcastChannel(built_channel(handoff.minted));
		channel.unref();
		channel.onmessage = (event: unknown) => {
			const recipe = parse_recipe(String((event as MessageEvent).data));
			if (
				recipe === null ||
				remote_of_tail(recipe.tail) !== null ||
				card_of_tail(recipe.tail) !== null
			)
				return;
			// oxlint-disable-next-line ogygia/no-silent-failures -- a head start only: the build's end asks for the file again and fails out loud
			void this.make(recipe, () => noted_original(output, recipe)).catch(() => {});
		};
		this.#scope.defer(() => channel.close());
	}

	static of(handoff: BuildHandoff, output: string): BuildMakes {
		let makes = BuildMakes.#open.get(handoff.minted);
		if (!makes) {
			makes = new BuildMakes(handoff, output);
			BuildMakes.#open.set(handoff.minted, makes);
		}
		return makes;
	}

	async make(
		recipe: Omit<Recipe, 'src'>,
		original: () => Uint8Array | Promise<Uint8Array>,
		card = false
	): Promise<Uint8Array> {
		const data = await this.#makes.get({ key: recipe_file(recipe), recipe, original, card });
		if (data === STALE) throw new Error('the build ended before the file was made');
		return data;
	}

	write(dest: string, data: Uint8Array): Promise<void> {
		return in_turn(this.#writes, async () => {
			await fs.promises.mkdir(path.dirname(dest), { recursive: true });
			await fs.promises.writeFile(dest, data);
		});
	}

	close(): void {
		BuildMakes.#open.delete(this.#minted);
		this.#scope.close();
	}
}

async function made(
	store: FileStore,
	key: string,
	recipe: Omit<Recipe, 'src'>,
	original: () => Uint8Array | Promise<Uint8Array>,
	card: boolean
): Promise<Uint8Array> {
	const kept = await store.find(key);
	if (kept) return fs.promises.readFile(kept.file);
	const bytes = await original();
	if (!card && (await source_id(bytes)) !== recipe.id)
		throw new Error(`its original is not the source ${recipe.id} any more`);
	const data = await (await pixels()).encode_recipe(bytes, recipe);
	await store.keep(key, data);
	return data;
}

interface Job {
	recipe: Omit<Recipe, 'src'>;
	source: string;
	original: () => Uint8Array;
	remote?: URL;
	card?: string;
}

function jobs_of(
	handoff: BuildHandoff,
	cfg: RenderConfig,
	warmed: Iterable<WarmSource>,
	output: string
): Map<string, Job> {
	const jobs = new Map<string, Job>();
	for (const source of warmed)
		for (const name of source.presets) {
			const preset = cfg.presets[name];
			if (!preset) continue;
			lay_out({ ...source.desc, src: '' }, preset_request(preset), cfg, (recipe) => {
				const file = source.originals[recipe.id] ?? source.file;
				jobs.set(built_file(recipe), {
					recipe,
					source: file,
					original: () => fs.readFileSync(file)
				});
				return '';
			});
		}
	let noted: string[] = [];
	try {
		noted = fs.readFileSync(handoff.minted, 'utf8').split('\n').filter(Boolean);
		// oxlint-disable-next-line ogygia/no-silent-failures -- no notes: nothing was prerendered
	} catch {}
	for (const line of noted) {
		const recipe = parse_recipe(line);
		if (recipe === null)
			throw new OgygiaError('image_unsettled', {
				url: line,
				source: line,
				reason: 'not an image recipe'
			});
		const remote = remote_of_tail(recipe.tail);
		const card = card_of_tail(recipe.tail);
		jobs.set(built_file(recipe), {
			recipe,
			source:
				remote?.href ?? (card === null ? recipe.tail : `the card ${card.card} (${card.props})`),
			original: () => noted_original(output, recipe),
			...(remote !== null ? { remote } : {}),
			...(card !== null ? { card: recipe.tail } : {})
		});
	}
	return jobs;
}

/** How the build fetches a remote image a prerendered page names (`remoteImage()`): its file in
 *  the build cache, under `image({ remote })` (./remote.ts `RemoteImages`). */
export type FetchRemote = (url: string) => Promise<string>;

/** How the build draws a card a prerendered page names: the own-size PNG of the card its tail
 *  names, when it is the source `id` (./card.ts `Cards.draw`). */
export type DrawCard = (tail: string, id: string) => Promise<Uint8Array>;

function no_card(tail: string): Promise<Uint8Array> {
	return Promise.reject(new Error(`its tail ${tail} names no card this build has`));
}

function no_remote(url: string): Promise<string> {
	return Promise.reject(
		new OgygiaError('image_remote_host', {
			where: 'a prerendered page',
			url,
			entry: entry_for(new URL(url))
		})
	);
}

async function remote_made(
	makes: BuildMakes,
	recipe: Omit<Recipe, 'src'>,
	url: URL,
	fetch_remote: FetchRemote
): Promise<{ recipe: Omit<Recipe, 'src'>; data: Uint8Array }> {
	const bytes = await fs.promises.readFile(await fetch_remote(url.href));
	const named = { ...recipe, id: await source_id(bytes) };
	return { recipe: named, data: await makes.make(named, () => bytes) };
}

const SCHEMES: readonly Buffer[] = [Buffer.from('https:'), Buffer.from('http:')];
const SCHEME_CHAR_RE = /[A-Za-z0-9+.-]/;
const KIT_DEFAULT_ORIGIN = 'http://sveltekit-prerender';

function scheme_before(bytes: Buffer, i: number, from: number): number {
	for (const scheme of SCHEMES) {
		const start = i - scheme.length;
		if (start < from || !bytes.subarray(start, i).equals(scheme)) continue;
		const before = bytes[start - 1];
		if (before === undefined || !SCHEME_CHAR_RE.test(String.fromCharCode(before))) return start;
	}
	return -1;
}

function unmarked(bytes: Buffer, cut: Buffer, origin: string, name: string): Buffer {
	const parts: Buffer[] = [];
	let at = 0;
	for (let i = bytes.indexOf(cut); i !== -1; i = bytes.indexOf(cut, at)) {
		const scheme = scheme_before(bytes, i, at);
		if (scheme === -1) parts.push(bytes.subarray(at, i));
		else if (origin === '' || origin === KIT_DEFAULT_ORIGIN)
			throw new OgygiaError('image_mark_left', {
				file: name,
				form: "made it absolute (`new URL(src, page.url)`) while `kit.prerender.origin` is Kit's default, so the build cannot know the site's origin: set it"
			});
		else parts.push(bytes.subarray(at, scheme), Buffer.from(origin));
		at = i + cut.length;
	}
	parts.push(bytes.subarray(at));
	return Buffer.concat(parts);
}

function renamed_in(bytes: Buffer, renamed: ReadonlyMap<string, string>): Buffer {
	let out = bytes;
	for (const [from, to] of renamed) {
		const was = Buffer.from(`${BUILT_DIR}/${from}-`);
		if (out.indexOf(was) === -1) continue;
		const now = Buffer.from(`${BUILT_DIR}/${to}-`);
		const parts: Buffer[] = [];
		let at = 0;
		for (let i = out.indexOf(was); i !== -1; i = out.indexOf(was, at)) {
			parts.push(out.subarray(at, i), now);
			at = i + was.length;
		}
		parts.push(out.subarray(at));
		out = Buffer.concat(parts);
	}
	return out;
}

function unmark(
	dir: string,
	mark: string,
	origin: string,
	renamed: ReadonlyMap<string, string>
): void {
	const cut = Buffer.from(mark);
	const label = Buffer.from(mark.slice(2));
	let names: string[];
	try {
		names = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' });
		// oxlint-disable-next-line ogygia/no-silent-failures -- no prerendered folder: nothing was prerendered
	} catch {
		return;
	}
	for (const name of names) {
		const file = path.join(dir, name);
		if (!fs.statSync(file).isFile()) continue;
		const bytes: Buffer = fs.readFileSync(file);
		let out: Buffer = bytes;
		if (mark !== '' && bytes.indexOf(label) !== -1) {
			out = unmarked(bytes, cut, origin, name);
			if (out.indexOf(label) !== -1)
				throw new OgygiaError('image_mark_left', { file: name, form: 'escaped or encoded it' });
		}
		out = renamed_in(out, renamed);
		if (out !== bytes) fs.writeFileSync(file, out);
	}
}

/** The server build's end: write every file the build makes (`warmed`, and the prerender's notes)
 *  under `<output>/client/<appDir>/`, then point every prerendered page at them, and hand the
 *  process (and what it starts after: an adapter's SPA fallback render) a handoff that says so, with
 *  no notes and no mark. `output` is Kit's build output. */
export async function write_built(
	handoff: BuildHandoff,
	cfg: RenderConfig,
	warmed: Iterable<WarmSource>,
	output: string,
	fetch_remote: FetchRemote = no_remote,
	draw_card: DrawCard = no_card
): Promise<void> {
	const makes = BuildMakes.of(handoff, output);
	const client = path.join(output, 'client', cfg.paths.app_dir);
	const renamed = new Map<string, string>();
	let settled: PromiseSettledResult<void>[];
	try {
		const jobs = jobs_of(handoff, cfg, warmed, output);
		settled = await Promise.allSettled(
			[...jobs].map(async ([name, { recipe, source, original, remote, card }]) => {
				try {
					if (card !== undefined) {
						const data = await makes.make(recipe, () => draw_card(card, recipe.id), true);
						await makes.write(path.join(client, ...name.split('/')), data);
						return;
					}
					if (remote !== undefined) {
						const made = await remote_made(makes, recipe, remote, fetch_remote);
						renamed.set(recipe.id, made.recipe.id);
						const file = built_file(made.recipe);
						await makes.write(path.join(client, ...file.split('/')), made.data);
						return;
					}
					const data = await makes.make(recipe, original);
					await makes.write(path.join(client, ...name.split('/')), data);
				} catch (e) {
					throw new OgygiaError('image_unsettled', {
						url: built_url(cfg.paths, recipe),
						source,
						reason: (e as Error).message
					});
				}
			})
		);
	} finally {
		makes.close();
	}
	const origin = origin_of(handoff.minted);
	fs.rmSync(path.dirname(handoff.minted), { recursive: true, force: true });
	const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason as Error] : []));
	if (failures.length) {
		for (const more of failures.slice(1)) console.error(more.message);
		throw failures[0];
	}
	if (handoff.mark || renamed.size)
		unmark(path.join(output, 'prerendered'), handoff.mark, origin, renamed);
	const done: BuildHandoff = { ...handoff, minted: '', mark: '', written: client };
	process.env[BUILD_ENV] = JSON.stringify(done);
}
