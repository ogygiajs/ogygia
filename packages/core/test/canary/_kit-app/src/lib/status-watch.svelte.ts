import { flushSync } from 'svelte';

export class StatusWatch {
	readonly at_init: number;
	readonly seen: number[] = [];

	constructor(page: { readonly status: number }) {
		this.at_init = page.status;
		$effect.root(() => {
			$effect(() => {
				this.seen.push(page.status);
			});
		});
		flushSync();
	}
}
