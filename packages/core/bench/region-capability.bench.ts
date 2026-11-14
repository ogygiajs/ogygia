// Region capabilities (server/hmac.ts): a page's worth of v3 mints, and the endpoint's checks of them.
import { bench } from '@bench/heisenbench/bench';
import { region_sign, region_verify, type RegionClaim } from '../src/server/hmac.ts';
import { region_request } from '../src/server/region-request.ts';

const SECRET = 'bench-secret-0123456789abcdef';
const AUD = '/__ogygia__';
const claim = (i: number): RegionClaim => ({
	id: (0xabcdef000000 + i).toString(16),
	payload: `eyJuIjo${i}fQ`,
	session: '',
	ttl: '',
	render: 'c0ffee0c0ffe',
	wakes: ''
});
const exp = () => Math.floor(Date.now() / 1000) + 1800;

bench(
	'region_sign: the holes of one page',
	({ n, at }) => {
		let len = 0;
		for (let i = 0; i < n; i++) len += region_sign(SECRET, AUD, at, claim(i)).length;
		return len;
	},
	{ setup: () => ({ n: 20, at: exp() }), scale: (_ctx, k) => ({ n: 20 * k, at: exp() }) }
);

bench(
	'region_verify: each hole request of one page (v3)',
	({ sigs, at }) => {
		let ok = 0;
		for (let i = 0; i < sigs.length; i++)
			if (region_verify(SECRET, AUD, '3', at, claim(i), sigs[i]!)) ok++;
		return ok;
	},
	{
		setup: () => {
			const at = exp();
			return {
				at: String(at),
				sigs: Array.from({ length: 20 }, (_, i) => region_sign(SECRET, AUD, at, claim(i)))
			};
		}
	}
);

bench(
	'region_request: the steps of each hole request of one page',
	({ n }) => {
		let sent = 0;
		for (let i = 0; i < n; i++) {
			const r = region_request.create();
			r.go('prechecked');
			r.go('probed');
			r.go('verified');
			r.go('charged');
			r.go('rendering');
			if (r.go('sent')) sent++;
		}
		return sent;
	},
	{ setup: () => ({ n: 20 }), scale: (_ctx, k) => ({ n: 20 * k }) }
);
