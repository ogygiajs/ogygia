import { f009, f012, f090 } from 'jumpstart-e2e-many-files';

const TABLE = new Map();
for (let k = 0; k < 2000; k++) TABLE.set(`k${k}`, (k * 2654435761) >>> 0);

export function u003(n) {
	return [f009(n), f012(n), f090(n)].join(' ').concat(' #', String(TABLE.get(`k${n % 2000}`) ?? 0));
}
