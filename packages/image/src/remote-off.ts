/**
 * `virtual:ogygia-image/remote` of an app with no `image({ remote })`: the image endpoint fetches
 * nothing, and answers every remote recipe 404 (`image_remote_refused`).
 *
 * @packageDocumentation
 */
import type { RemoteConfig, Transport } from './remote-fetch.ts';

/** No remote images. */
export const remote: RemoteConfig | null = null;

/** No transport. */
export const transport: (() => Promise<Transport>) | null = null;
