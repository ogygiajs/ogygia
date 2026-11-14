// An island entry whose module finishes loading only when its test opens the gate named by its
// query (`gated-entry.ts?name`, `entry_gate('name').resolve()`): a slow network the test controls,
// so the test never races a timer against the runner's speed.
import { entry_gate } from './entry-gates.ts';

const name = [...new URL(import.meta.url).searchParams.keys()].filter((k) => k !== 'import');
await entry_gate(name.join('&')).promise;
export { default } from './Counter.svelte';
