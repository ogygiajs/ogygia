/**
 * The Cloudflare Images binding maker (a Worker): makes each file with the binding the app's
 * wrangler config names (`images: { binding }`), read from the request's `event.platform.env`, and
 * keeps it in the Worker's cache (`caches.default`), since the CDN does not keep a Worker's answers
 * on its own. Holds no sharp, no file system: what a Worker can load.
 *
 * @packageDocumentation
 */
import {
	cloudflare_steps,
	STEPS_VERSION,
	type CloudflareTransform
} from '../encoders/cloudflare.ts';
import { CannotMake, type Kept, type MadeStore, type Maker } from '../maker.ts';
import { warn } from '../messages.ts';

interface Transformer {
	transform(t: CloudflareTransform): Transformer;
	output(o: { format: string; quality?: number; anim?: false }): Promise<{ response(): Response }>;
}

/** The part of an Images binding the maker uses. */
export interface ImagesBinding {
	input(stream: ReadableStream<Uint8Array>): Transformer;
}

interface WorkerCache {
	match(key: string): Promise<Response | undefined>;
	put(key: string, response: Response): Promise<void>;
}

const KEEP = 'public, max-age=31536000, immutable';
const STORE_ORIGIN = `https://ogygia-image.invalid/v${STEPS_VERSION}/`;

/** The files a Worker made, in its cache (`caches.default`), by recipe file name. */
export class CacheStore implements MadeStore {
	#cache: () => WorkerCache | undefined;

	constructor(cache: () => WorkerCache | undefined) {
		this.#cache = cache;
	}

	async find(key: string): Promise<unknown> {
		const hit = await this.#cache()?.match(STORE_ORIGIN + key);
		if (!hit) return null;
		// oxlint-disable-next-line ogygia/no-silent-failures -- only whether it is kept is asked: the body is not read
		await hit.body?.cancel().catch(() => {});
		return true;
	}

	async open(key: string): Promise<Kept | null> {
		const hit = await this.#cache()?.match(STORE_ORIGIN + key);
		if (!hit?.body) return null;
		const length = hit.headers.get('content-length');
		if (length !== null) return { body: hit.body, size: Number(length) };
		const data = new Uint8Array(await hit.arrayBuffer());
		return { body: new Response(data).body!, size: data.byteLength };
	}

	async keep(key: string, data: Uint8Array): Promise<boolean> {
		const cache = this.#cache();
		if (!cache) return false;
		try {
			await cache.put(
				STORE_ORIGIN + key,
				new Response(new Uint8Array(data), {
					headers: { 'cache-control': KEEP, 'content-length': String(data.byteLength) }
				})
			);
			return true;
		} catch (e) {
			warn('image_store_write_failed', { dir: 'caches.default', reason: (e as Error).message });
			return false;
		}
	}
}

function worker_cache(): WorkerCache | undefined {
	const caches = (globalThis as { caches?: { default?: WorkerCache } }).caches;
	return caches?.default;
}

function binding_of(platform: unknown, name: string): ImagesBinding | null {
	const env = (platform as { env?: Record<string, unknown> } | undefined)?.env;
	const b = env?.[name] as Partial<ImagesBinding> | undefined;
	return typeof b?.input === 'function' ? (b as ImagesBinding) : null;
}

function stream_of(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new Response(new Uint8Array(bytes)).body!;
}

/** The maker of the Images binding named `binding`. */
export function binding_maker(binding: string): Maker {
	return {
		parallel: 4,
		async make(bytes, recipe, platform) {
			const images = binding_of(platform, binding);
			if (images === null) throw new CannotMake('image_binding_missing', { binding });
			const { transforms, output } = cloudflare_steps(recipe);
			let t = images.input(stream_of(bytes));
			for (const step of transforms) t = t.transform(step);
			const res = (await t.output(output)).response();
			return new Uint8Array(await res.arrayBuffer());
		},
		store: new CacheStore(worker_cache),
		fit: null
	};
}
