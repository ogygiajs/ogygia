// Region capabilities (server/hmac.ts): a page's worth of v3 mints, the endpoint's checks of them,
// and the check of a URL minted before v3 (the v2 MAC), for comparison.
import { bench } from '@bench/heisenbench/bench';
import {
	region_mac_message,
	region_sign,
	region_verify,
	sign,
	type RegionClaim
} from '../src/server/hmac.ts';
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
	'region_verify: each hole request of a page cached before v3 (v2)',
	({ sigs, at }) => {
		let ok = 0;
		for (let i = 0; i < sigs.length; i++)
			if (region_verify(SECRET, AUD, '', at, claim(i), sigs[i]!)) ok++;
		return ok;
	},
	{
		setup: () => {
			const at = String(exp());
			const sigs = Array.from({ length: 20 }, (_, i) => {
				const c = claim(i);
				return sign(SECRET, region_mac_message(c.id, at, c.payload, '', '', c.render));
			});
			return { at, sigs };
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
