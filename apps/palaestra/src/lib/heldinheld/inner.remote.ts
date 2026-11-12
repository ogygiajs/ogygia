import { query } from '$app/server';
import { region } from 'ogygia';
import Inner from './Inner.svelte' with { region: 'raw' };

// the inner held region: a static one, awaited by its host in the render
export const heldInner = query(async () => await region(Inner, { label: 'inner region' }));
