import { query } from '$app/server';
import { region } from 'ogygia';
import Outer from './Outer.svelte' with { wake: 'idle' };

// the outer held region: an island, read by an island host's `.current`
export const heldOuter = query(async () => await region(Outer, { label: 'outer region' }));
