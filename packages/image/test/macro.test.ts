import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { dedent } from '@ogygia/core/plugin/utils';
import type { MacroHandler } from '@ogygia/compiler/vite';
import { image_call_edits, options_of_query } from '../src/vite/macro.ts';
import { image } from '../src/vite/index.ts';

/** `src` with the macro's edits applied, as ogygia's pipeline applies them. */
function rewrite_image_calls(...args: Parameters<typeof image_call_edits>): string {
	const src = args[0];
	let out = '';
	let last = 0;
	for (const e of image_call_edits(...args)) {
		out += src.slice(last, e.start) + e.text;
		last = e.end;
	}
	return out + src.slice(last);
}

let dir: string;
beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-macro-'));
	fs.writeFileSync(path.join(dir, 'hero.jpg'), '');
	fs.mkdirSync(path.join(dir, 'gallery'));
	fs.writeFileSync(path.join(dir, 'gallery', '01-a.jpg'), '');
	fs.writeFileSync(path.join(dir, 'gallery', '02-b.jpg'), '');
});

const mod = () => path.join(dir, 'page.ts');

describe('rewrite_image_calls', () => {
	test('a call becomes an import of the file under the og-image query', () => {
		const out = rewrite_image_calls(`const hero = import.meta.og.image('./hero.jpg');\n`, mod());
		expect(out).toContain(`import __og_image_0 from "./hero.jpg?og-image";`);
		expect(out).toContain('const hero = __og_image_0;');
	});

	test('options travel in the query, read back as written', () => {
		const out = rewrite_image_calls(
			`const hero = import.meta.og.image('./hero.jpg', { quality: 70, ops: { rotate: 90, grayscale: true } });`,
			mod()
		);
		const q = /\?(og-image=[^"]+)/.exec(out)![1]!;
		expect(options_of_query(q)).toEqual({ quality: 70, ops: { rotate: 90, grayscale: true } });
	});

	test('in a component the import lands in the script that calls', () => {
		const src = `${dedent`
			<script lang="ts">
				const hero = import.meta.og.image('./hero.jpg') as const;
			</script>
			<p>x</p>
		`}\n`;
		const out = rewrite_image_calls(src, path.join(dir, 'Page.svelte'));
		expect(out).toMatch(
			/^<script lang="ts">\nimport __og_image_0 from "\.\/hero\.jpg\?og-image";\n/
		);
		expect(out).toContain('<p>x</p>');
	});

	test('glob becomes an eager import.meta.glob under the query', () => {
		const out = rewrite_image_calls(
			`const g = import.meta.og.image.glob('./gallery/*.jpg');`,
			mod()
		);
		expect(out).toBe(
			`const g = import.meta.glob("./gallery/*.jpg", { eager: true, import: 'default', query: "?og-image" });`
		);
	});

	test('a glob that matches nothing fails the build', () => {
		expect(() => rewrite_image_calls(`import.meta.og.image.glob('./nope/*.jpg');`, mod())).toThrow(
			/matched no file/
		);
	});

	test('a missing file fails the build, naming it', () => {
		expect(() => rewrite_image_calls(`import.meta.og.image('./missing.jpg');`, mod())).toThrow(
			/missing\.jpg' does not exist/
		);
	});

	test('a variable path fails: the build reads literals', () => {
		expect(() => rewrite_image_calls(`import.meta.og.image(name);`, mod())).toThrow(
			/must be written out in place/
		);
	});

	test('a misspelled option fails instead of being ignored', () => {
		expect(() =>
			rewrite_image_calls(`import.meta.og.image('./hero.jpg', { qualty: 70 });`, mod())
		).toThrow(/unknown image option 'qualty'/);
	});

	test('warm names presets the config declares, one or a list; any other name fails the build', () => {
		const presets = ['cover', 'thumb'];
		const call = (opts: string) =>
			rewrite_image_calls(
				`import.meta.og.image('./hero.jpg', ${opts});`,
				mod(),
				undefined,
				() => {},
				presets
			);
		expect(options_of_query(call(`{ warm: 'cover' }`).split('?')[1]!.split('"')[0]!)).toEqual({
			warm: 'cover'
		});
		expect(() => call(`{ warm: ['thumb'] }`)).not.toThrow();
		expect(() => call(`{ warm: 'covr' }`)).toThrow(
			/warm names the preset 'covr', which image\(\{ presets \}\) does not declare\. Declared: cover, thumb/
		);
		expect(() => call(`{ warm: [] }`)).toThrow(/image option 'warm' must be a preset name/);
	});

	test('a remote URL fails with what to do instead', () => {
		expect(() =>
			rewrite_image_calls(`import.meta.og.image('https://example.com/a.jpg');`, mod())
		).toThrow(/remote images are not supported yet/);
	});

	test('a hand-written og-image query that is not the macro’s fails with its code', () => {
		expect(() => options_of_query('og-image=not-json')).toThrow(/og-image query/);
	});

	test("a call in a component template is left as is, for ogygia's macro_in_markup", () => {
		const svelte = path.join(dir, 'Card.svelte');
		for (const call of [
			`import.meta.og.image('./hero.jpg')`,
			`import.meta.og.image.glob('./gallery/*.jpg')`
		]) {
			const src = dedent`
				<script>let a = 1;</script>
				<p>{${call}}</p>
			`;
			expect(image_call_edits(src, svelte)).toEqual([]);
		}
	});

	test('the words in a component template’s text are not a call', () => {
		const svelte = path.join(dir, 'Doc.svelte');
		const src = '<p>Use import.meta.og.image to read a file.</p>\n';
		expect(rewrite_image_calls(src, svelte)).toBe(src);
	});

	test('a docs page that writes the call as text in its markup is no call (a <code> sample)', () => {
		const svelte = path.join(dir, 'Docs.svelte');
		const src = dedent`
			<script>let a = 1;</script>
			<p>Write <code>import.meta.og.image('./hero.jpg')</code> in a script.</p>
		`;
		expect(rewrite_image_calls(src, svelte)).toBe(src);
	});

	test('a module without the marker is returned as it is', () => {
		const src = 'const x = 1;';
		expect(rewrite_image_calls(src, mod())).toBe(src);
	});
});

describe('the image macro in dev', () => {
	/** The handler `image()` registers with ogygia, as ogygia calls it. */
	function handler(): (code: string, m: Parameters<MacroHandler>[1]) => unknown {
		const plugin = image()[0] as unknown as Record<symbol, { build(b: unknown): void }>;
		let found: MacroHandler | undefined;
		plugin[Symbol.for('ogygia.plugin')]!.build({
			macro: (_name: string, h: MacroHandler) => (found = h)
		});
		return found!;
	}

	test('a call to a missing file still watches it, so adding the file transforms the module again', async () => {
		const watched: string[] = [];
		const run = async () =>
			handler()(`const a = import.meta.og.image('./later.jpg');\n`, {
				id: mod(),
				rel: 'page.ts',
				root: dir,
				alias: [],
				markupExts: ['.svelte'],
				regions: (code) => [{ code, offset: 0 }],
				watch: (f) => watched.push(f)
			});
		await expect(run()).rejects.toThrow(/later\.jpg/);
		expect(watched).toContain(path.join(dir, 'later.jpg'));
	});

	test("a call in a markdown page's <script> is rewritten, in the regions ogygia hands the macro", async () => {
		const page = `${dedent`
			---
			title: Post
			---

			<script>
				const hero = import.meta.og.image('./hero.jpg');
			</script>

			# Post
		`}\n`;
		const open = page.indexOf('<script>') + '<script>'.length;
		const script = { code: page.slice(open, page.indexOf('</script>')), offset: open };
		const edits = (await handler()(page, {
			id: path.join(dir, '+page.svx'),
			rel: '+page.svx',
			root: dir,
			alias: [],
			markupExts: ['.svelte'],
			regions: () => [script],
			watch: () => {}
		})) as { start: number; end: number; text: string }[];
		let out = '';
		let last = 0;
		for (const e of edits) {
			out += page.slice(last, e.start) + e.text;
			last = e.end;
		}
		out += page.slice(last);
		expect(out).toContain(dedent`
			<script>
			import __og_image_0 from "./hero.jpg?og-image";
		`);
		expect(out).toContain('const hero = __og_image_0;');
		expect(out).toContain('# Post');
	});

	test('the macro answers with edits, so a module that uses it keeps its source map', async () => {
		const src = `${dedent`
			const hero = import.meta.og.image('./hero.jpg');
			export { hero };
		`}\n`;
		const edits = (await handler()(src, {
			id: mod(),
			rel: 'page.ts',
			root: dir,
			alias: [],
			markupExts: ['.svelte'],
			regions: (code) => [{ code, offset: 0 }],
			watch: () => {}
		})) as { start: number; end: number; text: string }[];
		expect(Array.isArray(edits)).toBe(true);
		const call = edits.find((e) => e.start !== e.end)!;
		expect(src.slice(call.start, call.end)).toBe(`import.meta.og.image('./hero.jpg')`);
		expect(call.text).toBe('__og_image_0');
		expect(edits.every((e) => e === call || e.start === e.end)).toBe(true);
	});
});
