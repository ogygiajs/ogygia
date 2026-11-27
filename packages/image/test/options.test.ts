// The plugin's option checks: a typo or a wrong value fails the build with a code.
import { expect, test } from 'vitest';
import { cloudflare, sharp, vercel } from '../src/vite/encoder.ts';
import { check_plugin_options } from '../src/vite/options.ts';

const presets = { prose: { width: 720 }, motion: { width: 240, sizes: '33vw' } };

test('markdown.animated names a preset the config declares', () => {
	expect(check_plugin_options({ presets, markdown: { animated: 'motion' } }).markdown).toEqual({
		animated: 'motion'
	});
	expect(() =>
		check_plugin_options({ presets, markdown: { width: 720, animated: 'motion' } })
	).not.toThrow();
});

test('markdown.animated naming no declared preset fails the build, listing the declared ones', () => {
	expect(() => check_plugin_options({ presets, markdown: { animated: 'motoin' } })).toThrow(
		/'markdown\.animated' must be the name of a preset image\(\{ presets \}\) declares \(declared: prose, motion\)[\s\S]*\/e\/image_option_invalid/
	);
	expect(() => check_plugin_options({ markdown: { animated: 'motion' } })).toThrow(
		/declared: \(none\)/
	);
	expect(() => check_plugin_options({ presets, markdown: { animated: 1 } })).toThrow(
		/'markdown\.animated' must be the name of a preset/
	);
});

test('an unknown markdown key still fails, naming the known ones', () => {
	expect(() => check_plugin_options({ markdown: { animate: 'motion' } })).toThrow(
		/unknown image option 'animate'\. Known: width, animated/
	);
});

test('encoder takes sharp(), cloudflare(), vercel() or a list of encoders, each at most once', () => {
	expect(check_plugin_options({ encoder: sharp() }).encoder).toEqual(sharp());
	expect(check_plugin_options({ encoder: [sharp()] }).encoder).toEqual([sharp()]);
	expect(check_plugin_options({ encoder: cloudflare() }).encoder).toEqual(cloudflare());
	expect(check_plugin_options({ encoder: [vercel(), sharp()] }).encoder).toEqual([
		vercel(),
		sharp()
	]);
	for (const encoder of [
		[],
		[sharp(), sharp()],
		[cloudflare(), cloudflare({ links: false })],
		[vercel(), vercel({ sizes: [640] })],
		'sharp',
		{},
		{ name: 'squoosh' },
		[sharp(), null]
	])
		expect(() => check_plugin_options({ encoder })).toThrow(
			/'encoder' must be an encoder from @ogygia\/image\/vite \(sharp\(\), cloudflare\(\), vercel\(\)\), or a non-empty list of them, each at most once[\s\S]*\/e\/image_option_invalid/
		);
});

test('an encoder list is in order of priority: one platform, at most one maker, and nothing after sharp(), which makes every file', () => {
	for (const encoder of [[vercel(), sharp()], [vercel()], [cloudflare()], [sharp()]])
		expect(() => check_plugin_options({ encoder })).not.toThrow();
	expect(() => check_plugin_options({ encoder: [sharp(), vercel()] })).toThrow(
		/'encoder'.*vercel\(\) after sharp\(\) is never used: sharp\(\) makes every file[\s\S]*\/e\/image_option_invalid/
	);
	expect(() => check_plugin_options({ encoder: [cloudflare(), vercel()] })).toThrow(
		/'encoder'.*one platform: cloudflare\(\) and vercel\(\) are two[\s\S]*\/e\/image_option_invalid/
	);
	expect(() => check_plugin_options({ encoder: [vercel(), cloudflare()] })).toThrow(
		/one platform: vercel\(\) and cloudflare\(\) are two/
	);
	for (const encoder of [
		[cloudflare(), sharp()],
		[cloudflare({ links: false }), sharp()]
	])
		expect(() => check_plugin_options({ encoder })).toThrow(
			/'encoder'.*one maker: cloudflare\(\) makes files with its Images binding and sharp\(\) with sharp[\s\S]*\/e\/image_option_invalid/
		);
});
