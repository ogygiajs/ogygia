import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import { MemoryStore, postrender } from '@ogygia/postrender';
// (a seed with a peer mounts its pages here; otherwise this hook passes every request on)
import { handle as mounted } from '$lib/gen/mount.server';

// (one store for every server instance and build of the run, as a shared cache is: the simulator
// takes what a world's servers pin on globalThis off when the world ends)
const shared = globalThis as unknown as { __sim_gen_store?: MemoryStore };
const store = (shared.__sim_gen_store ??= new MemoryStore());

export const handle = sequence(postrender.handle({ store }), ogygia.handle(), mounted);
