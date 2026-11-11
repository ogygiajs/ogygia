import { a } from './a.js';

export function b() {
	return 'b sees ' + a;
}
// b can also load a lazily (Kit's server does this kind of thing: a dynamic import into its own cycle)
export const load_a = () => import('./a.js');
