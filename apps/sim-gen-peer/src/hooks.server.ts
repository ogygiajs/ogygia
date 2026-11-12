import * as ogygia from 'ogygia/server';
// federate() registers the peer's widgets and exposed pages with the handle (/og/fragment/*)
import '$lib/gen/federation.server';

export const handle = ogygia.handle();
