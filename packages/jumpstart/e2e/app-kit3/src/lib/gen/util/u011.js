import { f036, f083, f092 } from 'jumpstart-e2e-many-files';

const TABLE = new Map();
for (let k = 0; k < 2000; k++) TABLE.set(`k${k}`, (k * 2654435761) >>> 0);

export function u011(n) {
	return [f036(n), f083(n), f092(n)].join(' ').concat(' #', String(TABLE.get(`k${n % 2000}`) ?? 0));
}
