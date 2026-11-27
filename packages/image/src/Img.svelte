<!--
@component
One image from a descriptor. Say how it sits on the page (a `preset` from `image({ presets })`, or
`layout` and at most a `width`, `aspect`); the files to ask for, the srcset, `sizes`, the width and
height attributes, the blur placeholder and the loading hints follow. Its own props say over the
preset's. Every file is a signed URL the image endpoint makes on first request. Server HTML only: it
ships no script, and no inline event handler. Besides its own props it passes `class`, `id`,
`style`, `title`, `crossorigin`, `referrerpolicy` and `draggable` to the `<img>`.

A source with twins (a dark file, art direction, a moving image's still) renders them as
`<source media>` rows the browser picks from. With `image({ theme })`, a source with a dark file
renders two `<picture>`s, one per theme, and the plugin's stylesheet shows one; `id` goes on the
light one's `<img>`.

```svelte
<Img of={hero} preset="cover" alt="The harbor at dusk" />
<Img of={post.data.cover} preset="thumb" alt={post.data.title} />
<Img of={avatar} layout="fixed" width={48} alt="" />
<Img of={hero} preset="cover" art={[{ media: '(max-width: 600px)', aspect: '4/5' }]} alt="…" />
```
-->
<script lang="ts">
	import 'virtual:ogygia-image/theme.css';
	import { untrack } from 'svelte';
	import type { HTMLImgAttributes } from 'svelte/elements';
	import type { ImageDescriptor, Twin } from './descriptor.ts';
	import type { ImageLayout, ImagePosition } from './config.ts';
	import type { Laid } from './layout.ts';
	import { placeholder_style } from './placeholder.ts';
	import { getImage, preset_of } from './render.ts';

	type Props = Pick<
		HTMLImgAttributes,
		'class' | 'id' | 'style' | 'title' | 'crossorigin' | 'referrerpolicy' | 'draggable'
	> & {
		/** The image: from `import.meta.og.image()`, a markdown or frontmatter image. */
		of: ImageDescriptor;
		/** What the image shows, for people who cannot see it. `""` for a decorative image. */
		alt: string;
		/** A preset from `image({ presets })`: how this image is shown. Own props say over it. */
		preset?: string;
		/** How the image sits on the page. Default `constrained`. */
		layout?: ImageLayout;
		/** Display width, CSS pixels. */
		width?: number;
		/** Display height, CSS pixels. With `width`, the image is cropped to that box. */
		height?: number;
		/** The box's shape (`16 / 9`, `'1/1'`): the files are cropped to it. */
		aspect?: number | string;
		/** Where a crop keeps. Default `center`. */
		position?: ImagePosition;
		/** Replaces the `sizes` the layout derives. */
		sizes?: string;
		/** The page's main image (its LCP): loads first, preloaded from the head. */
		priority?: boolean;
		/** Paint the blur placeholder until the image arrives. Default `true`. */
		placeholder?: boolean;
		/** Glide into the same source on the next page in a client-side navigation (a view
		 *  transition named by the source). At most one per source on a page. */
		morph?: boolean;
		/** Art direction: another crop (`aspect`, `position`, `width`) or another source (`of`) at
		 *  another media condition, each with its own box. Replaces the preset's `art`. */
		art?: Twin[];
	};

	let {
		of,
		alt,
		preset,
		layout,
		width,
		height,
		aspect,
		position,
		sizes,
		priority,
		placeholder,
		morph,
		art,
		class: klass,
		id,
		style,
		title,
		crossorigin,
		referrerpolicy,
		draggable
	}: Props = $props();

	type Theme = 'light' | 'dark';
	type Files = { src: string; srcset: string | undefined; sources: string[] };

	const p = $derived(preset_of(preset));
	const shown = $derived(layout ?? p.layout ?? 'constrained');
	const first = $derived(priority ?? p.priority ?? false);
	const laid = $derived(
		getImage(of, { preset, layout: shown, width, height, aspect, position, sizes, art })
	);
	const dark_of = $derived(of.twins?.find((t) => t.theme === 'dark')?.of);
	const preloads = $derived(laid.dark ? [...laid.preloads, ...laid.dark.preloads] : laid.preloads);
	const server_preload = $derived(
		typeof document === 'undefined'
			? null
			: document.head.querySelector(`link[rel="preload"][data-og-img="${of.id}"]`)
	);
	let kept = $state<{ id: string; files: Partial<Record<Theme, Files>> } | null>(null);

	function files_of(theme: Theme | undefined, l: Laid): Files {
		const own = kept?.id === of.id ? kept.files[theme ?? 'light'] : undefined;
		return own ?? { src: l.src, srcset: l.srcset, sources: l.sources.map((s) => s.srcset) };
	}

	function keep(theme: Theme | undefined, l: Laid) {
		return (img: HTMLImageElement): void => {
			const sources = img.parentElement?.querySelectorAll('source') ?? [];
			const files: Files = {
				src: img.getAttribute('src') ?? l.src,
				srcset: img.getAttribute('srcset') ?? undefined,
				sources: [...sources].map((s, i) => s.getAttribute('srcset') ?? l.sources[i]!.srcset)
			};
			const id = of.id;
			const before = untrack(() => (kept?.id === id ? kept.files : {}));
			kept = { id, files: { ...before, [theme ?? 'light']: files } };
		};
	}

	function css(l: Laid, ph: string | undefined): string | undefined {
		const boxes_differ = l.sources.some(
			(s) => s.width !== undefined && s.width * l.height !== s.height! * l.width
		);
		return (
			[
				(placeholder ?? p.placeholder ?? true) ? placeholder_style(ph) : '',
				l.cover
					? `object-fit:cover${boxes_differ ? '' : `;aspect-ratio:${l.width}/${l.height}`}`
					: '',
				(morph ?? p.morph) ? `view-transition-name:og-img-${of.id}` : '',
				typeof style === 'string' ? style : ''
			]
				.filter(Boolean)
				.join(';') || undefined
		);
	}
</script>

<svelte:head>
	{#if first && !server_preload}
		{#each preloads as preload (preload.media)}
			<link
				rel="preload"
				as="image"
				href={preload.href}
				imagesrcset={preload.srcset}
				imagesizes={preload.sizes}
				type={preload.type}
				media={preload.media}
				fetchpriority="high"
				data-og-img={of.id}
			/>
		{/each}
	{/if}
</svelte:head>

{#snippet img(l: Laid, files: Files, theme: Theme | undefined, ph: string | undefined)}
	<!-- svelte-ignore hydration_attribute_changed -- the browser cannot sign: it keeps the server's URLs, read back by keep() -->
	<img
		{@attach keep(theme, l)}
		class={klass}
		id={theme === 'dark' ? undefined : id}
		{title}
		{crossorigin}
		{referrerpolicy}
		{draggable}
		src={files.src}
		srcset={files.srcset}
		sizes={l.sizes}
		width={l.width}
		height={l.height}
		{alt}
		loading={first ? 'eager' : 'lazy'}
		decoding={first ? 'sync' : 'async'}
		fetchpriority={first ? 'high' : undefined}
		data-og-img={shown}
		style={css(l, ph)}
	/>
{/snippet}

{#snippet pic(l: Laid, theme: Theme | undefined, ph: string | undefined)}
	{@const files = files_of(theme, l)}
	{#if l.sources.length || theme}
		<picture data-og-theme={theme}>
			{#each l.sources as source, i (`${source.media}|${source.type}`)}
				<!-- svelte-ignore hydration_attribute_changed -- the browser cannot sign: it keeps the server's URLs, read back by keep() -->
				<source
					media={source.media}
					type={source.type}
					srcset={files.sources[i]}
					sizes={source.sizes ?? l.sizes}
					width={source.width}
					height={source.height}
				/>
			{/each}
			{@render img(l, files, theme, ph)}
		</picture>
	{:else}
		{@render img(l, files, theme, ph)}
	{/if}
{/snippet}

{#if laid.dark}
	{@render pic(laid, 'light', of.ph)}
	{@render pic(laid.dark, 'dark', dark_of?.ph)}
{:else}
	{@render pic(laid, undefined, of.ph)}
{/if}

<style>
	:global(:where(img[data-og-img='constrained'])) {
		max-width: 100%;
		height: auto;
	}
	:global(:where(img[data-og-img='fullWidth'])) {
		width: 100%;
		height: auto;
	}
</style>
