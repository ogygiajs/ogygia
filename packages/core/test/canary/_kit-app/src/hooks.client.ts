import { page } from '$app/state';
import { StatusWatch } from '$lib/status-watch.svelte';

export const init = (): void => {
	Object.assign(window, {
		__canary_status: new StatusWatch(page),
		__canary_runtime_before_init:
			(window as { __canary_runtime?: boolean }).__canary_runtime === true
	});
};
