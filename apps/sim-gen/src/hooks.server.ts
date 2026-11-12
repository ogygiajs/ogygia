import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
// (a seed with a peer mounts its pages here; otherwise this hook passes every request on)
import { handle as mounted } from '$lib/gen/mount.server';

export const handle = sequence(ogygia.handle(), mounted);
