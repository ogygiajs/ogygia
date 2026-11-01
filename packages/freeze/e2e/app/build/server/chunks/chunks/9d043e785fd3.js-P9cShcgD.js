import './async.js-BHxnfxQk.js';
import { a1 as escape_html } from './server.js-BBF-BCcH.js';

// src/lib/hole-serial.ts
var hole_serial = 0;
function next_hole_serial() {
	return ++hole_serial;
}
// src/lib/Hole.svelte
function Hole($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { ogygiaFallback } = $$props;
		const serial = next_hole_serial();
		$$renderer.push(`<p data-hole-serial="">${escape_html(serial)}</p>`);
	});
}
// virtual:ogygia/island/9d043e785fd3.js
var _9d043e785fd3_default = Hole;

export { Hole as H, _9d043e785fd3_default as _ };
//# sourceMappingURL=9d043e785fd3.js-P9cShcgD.js.map
