import { query } from '$app/server';
import { region } from 'ogygia';
import Card from './Card.svelte' with { wake: 'load' };

export const card = query(async () => await region(Card, { label: 'card' }));
