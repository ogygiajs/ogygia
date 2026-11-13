import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import { rewrite } from '@ogygia/rewrite';
import { scoped_element } from '$lib/restorelab/scoped-render';

// THE RESTORE LAB's rewrite: a scoped web-component render of every demo-* element in every document
// and region answer (../../restore.spec.ts).
const components = rewrite({
	match: 'demo-',
	render: (elements) => elements.map((el) => scoped_element(el.html))
});

export const handle = sequence(components, ogygia.handle());
