import type { Handle } from '@sveltejs/kit';
import { try_get_request_store } from '@sveltejs/kit/internal/server';
import { getRequestEvent } from '$app/server';
import * as ogygia from '$lib/ogygia';

class RequestProbe {
	static async read(): Promise<unknown> {
		const state = ogygia.KitRequestStore.state();
		const implicit = state?.remote?.implicit;
		const remotes = implicit
			? [...implicit].map(([internals, record]) => ({
					id: internals.id ?? null,
					type: internals.type,
					payloads: Object.keys(record),
					memo: typeof state.remote.data?.get(internals)
				}))
			: null;
		const seed =
			implicit && ogygia.create_remote_key
				? await ogygia.collect_remote_seed(implicit, null, {
						memo: (internals) => state.remote.data?.get(internals),
						key: ogygia.create_remote_key
					})
				: null;
		return {
			store: state !== null && state === try_get_request_store()?.state,
			event: ogygia.KitRequestStore.event() === getRequestEvent(),
			remotes,
			seed
		};
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (!event.url.searchParams.has('probe')) return response;
	const html = await response.text();
	return Response.json({ html, probe: await RequestProbe.read() });
};
