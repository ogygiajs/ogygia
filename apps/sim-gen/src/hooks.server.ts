import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import { MemoryStore, postrender } from '@ogygia/postrender';
// (a seed with a peer mounts its pages here; otherwise this hook passes every request on)
import { handle as mounted } from '$lib/gen/mount.server';
// (a seed's flag, registered before the first request, and its exposure sink; empty without one)
import '$lib/gen/flags.server';
// (a seed's reshape pass, in front of ogygia's: a web-component server render; else it passes on)
import { handle as reshaped } from '$lib/gen/reshape.server';

// (one store for every server instance and build of the run, as a shared cache is: the simulator
// takes what a world's servers pin on globalThis off when the world ends)
const shared = globalThis as unknown as { __sim_gen_store?: MemoryStore };
const store = (shared.__sim_gen_store ??= new MemoryStore());

export const handle = sequence(postrender.handle({ store }), reshaped, ogygia.handle(), mounted);
