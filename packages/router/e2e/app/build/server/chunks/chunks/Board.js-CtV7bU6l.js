import './async.js-FhULVWAw.js';
import { a1 as escape_html } from './server.js-B9P4ExQ-.js';

// ../island-pkg/src/pages/Board.svelte
function Board($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		$$renderer.push(`<section data-pkg-board=""><h1>${escape_html(data.title)}</h1> <button data-pkg-board-btn="">board hits: ${escape_html(0)}</button></section>`);
	});
}

export { Board as B };
//# sourceMappingURL=Board.js-CtV7bU6l.js.map
