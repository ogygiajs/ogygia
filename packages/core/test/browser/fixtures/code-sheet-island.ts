// An island's file whose load puts a stylesheet in the head, as a bundler's preloader does for the
// CSS its chunks need (Vite's `__vitePreload` appends a `<link rel="stylesheet" crossorigin>`).
const link = document.createElement('link');
link.rel = 'stylesheet';
link.crossOrigin = '';
link.href = new URL('./region-sheet.css', import.meta.url).href;
document.head.appendChild(link);

export { default } from './Counter.svelte';
