// The random port's bytes and UUIDs are the platform's Web Crypto (a capability's nonce, a trace id,
// a visitor id), never `Math.random` and never a seeded generator. Only a simulated run swaps in
// seeded randomness, by installing its own platform (internal/sim, a private package no package
// imports). With no Web Crypto at all, the port throws rather than fall back to something weaker.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { random } from '../src/index.ts';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('random.bytes and random.uuid are Web Crypto', () => {
	it('bytes are crypto.getRandomValues, and Math.random is never read', () => {
		const get = vi.spyOn(globalThis.crypto, 'getRandomValues');
		const weak = vi.spyOn(Math, 'random');
		const b = random.bytes(32);
		expect(b).toHaveLength(32);
		expect(get).toHaveBeenCalledTimes(1);
		expect(get.mock.results[0]!.value).toBe(b);
		expect(weak).not.toHaveBeenCalled();
	});

	it('a uuid is crypto.randomUUID, and Math.random is never read', () => {
		const made = vi.spyOn(globalThis.crypto, 'randomUUID');
		const weak = vi.spyOn(Math, 'random');
		const id = random.uuid();
		expect(made).toHaveBeenCalledTimes(1);
		expect(id).toBe(made.mock.results[0]!.value);
		expect(weak).not.toHaveBeenCalled();
	});

	it('without randomUUID (a page not on HTTPS), a uuid is made from crypto.getRandomValues', () => {
		const get = vi.fn(<T extends ArrayBufferView>(a: T): T => {
			new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(0x5a);
			return a;
		});
		vi.stubGlobal('crypto', { getRandomValues: get });
		const weak = vi.spyOn(Math, 'random');
		expect(random.uuid()).toBe('5a5a5a5a-5a5a-4a5a-9a5a-5a5a5a5a5a5a');
		expect(get).toHaveBeenCalledTimes(1);
		expect(weak).not.toHaveBeenCalled();
	});

	it('with no Web Crypto at all, bytes and uuid throw rather than fall back', () => {
		vi.stubGlobal('crypto', undefined);
		const weak = vi.spyOn(Math, 'random');
		expect(() => random.bytes(16)).toThrow();
		expect(() => random.uuid()).toThrow();
		expect(weak).not.toHaveBeenCalled();
	});
});

describe('no seeded generator ships', () => {
	const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
	const sources = (dir: string, out: string[] = []): string[] => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) sources(p, out);
			else if (/\.(ts|js|svelte)$/.test(name)) out.push(p);
		}
		return out;
	};

	it("no package's source imports the simulator, whose seeded generator it is", () => {
		const found: string[] = [];
		for (const pkg of readdirSync(PACKAGES)) {
			let src: string;
			try {
				src = join(PACKAGES, pkg, 'src');
				if (!statSync(src).isDirectory()) continue;
			} catch {
				continue; // ok: a package folder without source
			}
			for (const file of sources(src)) {
				const text = readFileSync(file, 'utf8');
				if (/from\s+['"][^'"]*(internal\/sim|ogygia-internal-sim)/.test(text)) found.push(file);
			}
		}
		expect(found).toEqual([]);
	});

	it("the ports' bytes and uuid read only the platform's crypto", () => {
		const PORTS = fileURLToPath(new URL('../src/ports/', import.meta.url));
		for (const file of ['random.ts', 'uuid.ts']) {
			const text = readFileSync(join(PORTS, file), 'utf8')
				// (`float` is Math.random by contract: never a security value)
				.replace(/export const float[^\n]*\n/, '');
			expect(text, file).not.toMatch(/Math\.random|realm\.Math/);
		}
	});
});
