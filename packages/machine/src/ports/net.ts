import { realm } from './realm.ts';

/** A request over the network. */
export const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
	realm.fetch(input, init);

/** A live stream of server-sent events. */
export const stream = (url: string | URL, init?: EventSourceInit): EventSource =>
	new realm.EventSource!(url, init);
