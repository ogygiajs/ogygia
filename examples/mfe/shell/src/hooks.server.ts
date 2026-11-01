import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import * as ogygia from 'ogygia/server';
import { postrender } from '@ogygia/postrender';
import { shell_router } from '$lib/shell-router.js';

// The shell's programmatic router owns /cms/* (the mounted CMS app); everything else
// falls through to the Kit filesystem routes (the home page) — two routers, one app.
const mounted: Handle = async ({ event, resolve }) => shell_router.handle({ event, resolve });

// postrender's handle first: a stored page is served before anything renders.
export const handle = sequence(postrender.handle(), ogygia.handle(), mounted);
