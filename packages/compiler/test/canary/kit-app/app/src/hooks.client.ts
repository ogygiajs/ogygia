import { page } from '$app/state';
import { StatusWatch } from '$lib/status-watch.svelte';

export const init = (): void => {
	Object.assign(window, { __canary_status: new StatusWatch(page) });
};
