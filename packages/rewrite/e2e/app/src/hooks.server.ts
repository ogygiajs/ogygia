import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import * as reshape from '@ogygia/rewrite';
import { scoped_render } from '$lib/restorelab/scoped-render';

// THE RESTORE LAB's pass: a scoped web-component render over every document and region answer
// (../../restore.spec.ts).
export const handle = sequence(
	reshape.handle((html) => scoped_render(html)),
	ogygia.handle()
);
