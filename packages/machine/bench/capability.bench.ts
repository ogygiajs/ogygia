// capability(): a page's worth of mints and the checks a region endpoint makes, with a stand-in
// signer (the cryptography is the caller's; this counts the module's own steps: the message, the
// token, the checks before and after the signature, the replay memory).
import { bench } from '@bench/heisenbench/bench';
import { capability, type Signer } from '../src/index.ts';

const signer: Signer = {
	sign: (m) => {
		let h = 2166136261;
		for (let i = 0; i < m.length; i++) h = Math.imul(h ^ m.charCodeAt(i), 16777619) >>> 0;
		return h.toString(16).padStart(8, '0').repeat(4);
	},
	verify(m, sig) {
		return this.sign(m) === sig;
	}
};
const AUD = 'https://app.example';
const fields = (i: number) => ['abcdef012345', `eyJuIjo${i}fQ`, '', '60'];

bench(
	'capability: mint the regions of one page',
	({ n }) => {
		const cap = capability({ name: 'region', version: 3, signer, ttl: { max: 3_600_000 } });
		let len = 0;
		for (let i = 0; i < n; i++) len += cap.mint(AUD, fields(i), 60_000).length;
		return len;
	},
	{ setup: () => ({ n: 20 }), scale: (_ctx, k) => ({ n: 20 * k }) }
);

bench(
	'capability: check each region request, with replay memory on',
	({ tokens, cap }) => {
		let ok = 0;
		for (let i = 0; i < tokens.length; i++) if (cap.check(tokens[i]!, AUD, fields(i)).ok) ok++;
		return ok;
	},
	{
		setup: () => {
			const cap = capability({
				name: 'region',
				version: 3,
				signer,
				ttl: { max: 3_600_000 },
				replay: { max: 1024 }
			});
			const mint = capability({ name: 'region', version: 3, signer, ttl: { max: 3_600_000 } });
			return {
				cap,
				tokens: Array.from({ length: 20 }, (_, i) => mint.mint(AUD, fields(i), 60_000))
			};
		},
		scale: (_ctx, k) => {
			const cap = capability({
				name: 'region',
				version: 3,
				signer,
				ttl: { max: 3_600_000 },
				replay: { max: 1024 * k }
			});
			const mint = capability({ name: 'region', version: 3, signer, ttl: { max: 3_600_000 } });
			return {
				cap,
				tokens: Array.from({ length: 20 * k }, (_, i) => mint.mint(AUD, fields(i), 60_000))
			};
		}
	}
);
