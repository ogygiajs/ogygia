/**
 * The FILE STORE: every file made from a recipe, kept on disk by its key (the recipe's file name,
 * ./recipe.ts `recipe_file`, which names its source by content), so the next ask is a file read. One
 * store per place it runs:
 *
 * - the build and the dev server (the plugin hands its process the build cache's folder,
 *   `node_modules/.ogygia/image/files/v<encoder>-<libvips>/`): a warm build or a CI run with the
 *   cache kept encodes nothing it made before, and Kit's prerender, which runs in a worker of the
 *   same process, reads the same folder. Kept to {@link BUILD_STORE_MAX};
 * - a live server: a folder under the system's temporary folder that only this user owns, one per
 *   encoder and libvips version, kept to {@link RUNTIME_STORE_MAX} while it runs.
 *
 * Every user of one folder in a process shares one store ({@link FileStore.shared}), so the size
 * holds for a dev server's whole run; each process (the build, its prerender worker) keeps its own
 * count, so the cap is per process, not across them. Either way the least recently used files go
 * first past the size, files unused for a month go at start (a file found is marked used, at most
 * once a day), and another version's folder goes once no server has used it for a week. A file that
 * cannot be written is not kept (`image_store_write_failed`): the caller still has its bytes.
 *
 * Server and build only (Node).
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cache, clock, random, type Cache } from '@ogygia/machine';
import { warn } from './messages.ts';

/** Bump when the encoder's output changes for the same input: every cached file is made again, and
 *  every source gets a new id, so every file a new name. test/encode-settings.test.ts holds what
 *  each version asks sharp for. */
export const ENCODER_VERSION = 4;

/** A source's id: its bytes (and the encoder's version), so every file made from it names its
 *  content. Whoever makes a file checks the original it read against the id it is named by. */
export function source_id(bytes: Uint8Array): string {
	return crypto
		.createHash('sha256')
		.update(bytes)
		.update(`\0encoder ${ENCODER_VERSION}`)
		.digest('base64url')
		.slice(0, 16);
}

/** What the plugin hands the processes of one `vite build` or dev server (and Kit's prerender
 *  worker, which inherits the environment): the store's folder, the file the prerender notes its
 *  recipes in, and the build's mark. Internal: the plugin writes it, nothing else should. */
export const BUILD_ENV = '__OGYGIA_IMAGE_BUILD';

/** The build's handoff, when this process runs under the plugin. */
export interface BuildHandoff {
	/** The store's folder. */
	store: string;
	/** The file every recipe a prerendered page names is noted in, one per line (its path below
	 *  the endpoint's prefix, unsigned: the build's end makes each). */
	minted: string;
	/** What a prerendered page's file URL starts with until the build's end makes the file: a host no
	 *  crawler follows (`//<random>.ogygia.invalid`), removed from every prerendered page then. Empty
	 *  outside a build. */
	mark: string;
	/** Once the build's end wrote its files: the client output's app folder they sit under (empty
	 *  until then, with no notes and no mark after). A page rendered after that (an adapter's SPA
	 *  fallback) names those files as they are. */
	written: string;
	/** The app's root (Vite's `root`). */
	root: string;
}

/** The handoff the plugin left in the environment, or null on a live server. */
export function build_handoff(): BuildHandoff | null {
	const raw = typeof process === 'undefined' ? undefined : process.env[BUILD_ENV];
	if (!raw) return null;
	const v = JSON.parse(raw) as Partial<BuildHandoff>;
	if (typeof v.store !== 'string' || typeof v.minted !== 'string') return null;
	return {
		store: v.store,
		minted: v.minted,
		mark: typeof v.mark === 'string' ? v.mark : '',
		written: typeof v.written === 'string' ? v.written : '',
		root: typeof v.root === 'string' ? v.root : ''
	};
}

/** Images under `src/` that are never published: the server's own folder and test files. The
 *  plugin's sources glob leaves out the same. */
export const UNPUBLISHED_RE: RegExp =
	/^src\/lib\/server\/|(?:^|\/)__tests__\/|\.(?:test|spec)\.[^/]+$/;

const RASTER_RE = /\.(?:png|jpe?g|webp|avif|gif|tiff?)$/i;

/** Is `rel` (a path from the app's root) an original the image endpoint may read: a raster under
 *  `src/` that is published (what the sources glob takes)? */
export function published(rel: string): boolean {
	return rel.startsWith('src/') && RASTER_RE.test(rel) && !UNPUBLISHED_RE.test(rel);
}

/** Note a recipe's path in the build's `minted` file, its folder made again if the build's end
 *  removed it (a `vite build --watch` rebuild prerenders again). */
export function note_built(minted: string, recipe_path: string): void {
	fs.mkdirSync(path.dirname(minted), { recursive: true });
	fs.appendFileSync(minted, `${recipe_path}\n`);
}

const ORIGIN_FILE = 'origin.txt';

/** Note the origin Kit prerenders at (`kit.prerender.origin`: the origin of every page's URL while
 *  it prerenders) beside the build's notes. The first one noted stays: one build, one origin. */
export function note_origin(minted: string, origin: string): void {
	fs.mkdirSync(path.dirname(minted), { recursive: true });
	try {
		fs.writeFileSync(path.join(path.dirname(minted), ORIGIN_FILE), origin, { flag: 'wx' });
		// oxlint-disable-next-line ogygia/no-silent-failures -- a file already there holds the origin this build noted first
	} catch {}
}

/** The origin the build's prerender noted, or '' when nothing was prerendered. */
export function origin_of(minted: string): string {
	try {
		return fs.readFileSync(path.join(path.dirname(minted), ORIGIN_FILE), 'utf8');
		// oxlint-disable-next-line ogygia/no-silent-failures -- no file: no page was prerendered
	} catch {
		return '';
	}
}

function version_dir(vips: string): string {
	return `v${ENCODER_VERSION}-${vips}`;
}
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;
const MONTH_MS = 30 * 24 * HOUR_MS;
const USED = '.used';

/** The most a live server's store keeps on disk, in bytes. */
export const RUNTIME_STORE_MAX: number = 512 * 1024 * 1024;
/** The most the build cache's store keeps, in bytes. */
export const BUILD_STORE_MAX: number = 2 * 1024 * 1024 * 1024;

/** Files made from recipes, by key, in one folder, at most `max` bytes of them: past it, the least
 *  recently kept or found go first. A store counts the files it kept or found; {@link load} counts
 *  the ones already there, the oldest as the least recently used. */
export class FileStore {
	readonly dir: string;
	#files: Cache<string, number>;
	#said_write = false;
	#counted: Promise<void> = Promise.resolve();

	constructor(dir: string, max: number = BUILD_STORE_MAX) {
		this.dir = dir;
		this.#files = cache<string, number>({
			name: 'image file store',
			max,
			weigh: (size) => size,
			onEvict: (file, _size, why) => {
				if (why !== 'size') return;
				// oxlint-disable-next-line ogygia/no-silent-failures -- a file that could not be removed stays until the next load counts it again
				void fs.promises.rm(file, { force: true }).catch(() => {});
			}
		});
	}

	/** Where the file of `key` is kept. */
	file(key: string): string {
		const h = crypto.createHash('sha256').update(key).digest('base64url').slice(0, 32);
		return path.join(this.dir, h.slice(0, 2), h);
	}

	/** The file of `key`, when it is made: its path and size. A file last used over a day ago is
	 *  marked used now, so its age at the next {@link load} is its last use, not its making. */
	async find(key: string): Promise<{ file: string; size: number } | null> {
		await this.#counted;
		const file = this.file(key);
		let size: number;
		try {
			const stat = await fs.promises.stat(file);
			if (!stat.isFile()) return null;
			size = stat.size;
			if (clock.wall() - stat.mtimeMs > DAY_MS)
				// oxlint-disable-next-line ogygia/no-silent-failures -- a mark that failed only lets the file age: it is made again after a month
				void touch_file(file).catch(() => {});
			// oxlint-disable-next-line ogygia/no-silent-failures -- no file is a miss: the caller makes it
		} catch {
			return null;
		}
		if (this.#files.get(file) === undefined) this.#files.set(file, size);
		return { file, size };
	}

	static #open = new Map<string, FileStore>();

	/** The one store of `dir` in this process, the files already there counted as it opens: every
	 *  user of the folder (the endpoint, the build's writer) keeps it to one `max`. */
	static shared(dir: string, max: number = BUILD_STORE_MAX): FileStore {
		let store = FileStore.#open.get(dir);
		if (!store) {
			store = new FileStore(dir, max);
			FileStore.#open.set(dir, store);
			// oxlint-disable-next-line ogygia/no-silent-failures -- load catches each read it cannot make: a folder it could not count is counted at the next start
			store.#counted = store.load().catch(() => {});
		}
		return store;
	}

	/** Keep `data` as the file of `key` (written whole, then moved in: a reader never sees half).
	 *  False when it could not be written (said once per store: `image_store_write_failed`). */
	async keep(key: string, data: Uint8Array): Promise<boolean> {
		await this.#counted;
		const file = this.file(key);
		const tmp = `${file}.${process.pid}.${random.uuid()}.tmp`;
		try {
			await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
			await fs.promises.writeFile(tmp, data, { mode: 0o600 });
			await fs.promises.rename(tmp, file);
		} catch (e) {
			if (!this.#said_write)
				warn('image_store_write_failed', { dir: this.dir, reason: (e as Error).message });
			this.#said_write = true;
			// oxlint-disable-next-line ogygia/no-silent-failures -- a half-written file that is not there needs no removing
			void fs.promises.rm(tmp, { force: true }).catch(() => {});
			return false;
		}
		this.#files.set(file, data.byteLength);
		// oxlint-disable-next-line ogygia/no-silent-failures -- the mark only spares this folder from a newer server's tidy: a miss shows as a file made again
		void touch(path.join(this.dir, USED)).catch(() => {});
		return true;
	}

	/** Count the files already in the folder, oldest first: past `max`, the oldest go. Files older
	 *  than a month, and a write an ended process left half done, are removed. */
	async load(): Promise<void> {
		const now = clock.wall();
		const found: Array<[string, number, number]> = [];
		let shards: string[];
		try {
			shards = await fs.promises.readdir(this.dir);
			// oxlint-disable-next-line ogygia/no-silent-failures -- no folder yet holds nothing to count
		} catch {
			return;
		}
		for (const shard of shards) {
			if (shard === USED) continue;
			const at = path.join(this.dir, shard);
			try {
				for (const name of await fs.promises.readdir(at)) {
					const file = path.join(at, name);
					const stat = await fs.promises.stat(file);
					const age = now - stat.mtimeMs;
					if (age > MONTH_MS || (name.endsWith('.tmp') && age > HOUR_MS))
						await fs.promises.rm(file, { force: true });
					else if (!name.endsWith('.tmp')) found.push([file, stat.size, stat.mtimeMs]);
				}
				// oxlint-disable-next-line ogygia/no-silent-failures -- a shard that could not be read is counted at the next load
			} catch {}
		}
		found.sort((a, b) => a[2] - b[2]);
		for (const [file, size] of found) if (!this.#files.has(file)) this.#files.set(file, size);
	}
}

function touch_file(file: string): Promise<void> {
	const now = new Date(clock.wall());
	return fs.promises.utimes(file, now, now);
}

async function touch(file: string): Promise<void> {
	const now = new Date(clock.wall());
	try {
		await fs.promises.utimes(file, now, now);
	} catch {
		await fs.promises.writeFile(file, '', { mode: 0o600 });
	}
}

async function tidy_versions(root: string, dir: string): Promise<void> {
	const now = clock.wall();
	try {
		for (const name of await fs.promises.readdir(root)) {
			const other = path.join(root, name);
			if (other === dir) continue;
			const used = await fs.promises
				.stat(path.join(other, USED))
				.catch(() => fs.promises.stat(other));
			if (now - used.mtimeMs > WEEK_MS)
				await fs.promises.rm(other, { recursive: true, force: true });
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- a tidy is housekeeping: what it could not remove stays until the next start tries again
	} catch {}
}

function open_store(root: string, dir: string, max: number): FileStore {
	const store = FileStore.shared(dir, max);
	// oxlint-disable-next-line ogygia/no-silent-failures -- the mark and the tidy are housekeeping: each catches its own failures
	void touch(path.join(dir, USED))
		.catch(() => {})
		.then(() => tidy_versions(root, dir));
	return store;
}

/** Open the build cache's store under `cache` (the plugin's `BuildCache` folder), for files made
 *  with libvips `vips`, and give its folder: marked as in use, kept to {@link BUILD_STORE_MAX}, the
 *  unused version folders beside it removed. */
export function open_build_store(cache: string, vips: string): string {
	const dir = path.join(cache, version_dir(vips));
	fs.mkdirSync(dir, { recursive: true });
	open_store(cache, dir, BUILD_STORE_MAX);
	return dir;
}

function owned(dir: string): boolean {
	const stat = fs.lstatSync(dir);
	if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
	if (typeof process.getuid !== 'function') return true;
	return stat.uid === process.getuid() && (stat.mode & 0o077) === 0;
}

/** A live server's store: `<tmp>/ogygia-image-<uid>/<version>/`, made owner-only. Null (no store:
 *  each file is made per ask, flights still share one) when the folder is not safely this user's: a
 *  folder another user made first, or a link, could hand out bytes it chose. `vips` is the libvips
 *  version the files are made with (read where sharp is loaded: ./settle.ts). */
export function runtime_store(vips: string, tmp: string = os.tmpdir()): FileStore | null {
	const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
	const root = path.join(tmp, `ogygia-image-${uid}`);
	try {
		fs.mkdirSync(root, { mode: 0o700 });
		// oxlint-disable-next-line ogygia/no-silent-failures -- an existing folder is checked below
	} catch {}
	try {
		if (!owned(root)) {
			warn('image_store_unsafe', { dir: root });
			return null;
		}
		const dir = path.join(root, version_dir(vips));
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (!owned(dir)) {
			warn('image_store_unsafe', { dir });
			return null;
		}
		return open_store(root, dir, RUNTIME_STORE_MAX);
	} catch (e) {
		warn('image_store_unsafe', { dir: `${root} (${(e as Error).message})` });
		return null;
	}
}
