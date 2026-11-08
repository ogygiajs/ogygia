// An island entry whose module takes a while to load (a slow network): a test can act while it does.
await new Promise((resolve) => setTimeout(resolve, 400));
export { default } from './Counter.svelte';
