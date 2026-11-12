/**
 * Federation's keys for a simulated world: an Ed25519 pair per app, made from the seed, so a run's
 * signatures replay (Ed25519 signs deterministically; only the key is random, and here it is the
 * seed's). Encoded as `npx ogygia keys` prints them: the private key PKCS#8 DER, the public SPKI DER,
 * both base64.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { Rng } from './rng.ts';

/** PKCS#8 DER of an Ed25519 private key, up to its 32 seed bytes. */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

/** An Ed25519 pair drawn from `rng`. */
export function key_pair(rng: Rng): { pub: string; priv: string } {
	const seed = Buffer.from(Array.from({ length: 32 }, () => rng.int(256)));
	const der = Buffer.concat([PKCS8_ED25519, seed]);
	const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
	return {
		priv: der.toString('base64'),
		pub: createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
	};
}
