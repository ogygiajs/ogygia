// A shell page hosts its peers' islands, whose code loads from the peers: their origins (every
// replica's) are the code origins the shell's runtime script names (core's `codeOrigins` hook,
// runtime/code-origins.ts). No federation: none.
import { afterEach, describe, expect, it } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import fed_server from '../src/server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => set_federation(null));

describe('the code origins a shell allows', () => {
	it('are every peer’s origins, replicas included', () => {
		federate({
			name: 'shell',
			peers: {
				cms: { origin: 'https://cms.example' },
				dash: { origin: ['https://dash.example/', 'https://dash-2.example:8443'] }
			}
		});
		expect(fed_server.codeOrigins?.()).toEqual([
			'https://cms.example',
			'https://dash.example',
			'https://dash-2.example:8443'
		]);
	});

	it('no federate(): none', () => {
		expect(fed_server.codeOrigins?.() ?? []).toEqual([]);
	});
});
