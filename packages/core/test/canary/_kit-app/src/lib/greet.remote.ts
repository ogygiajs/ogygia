import { query } from '$app/server';

export const greet = query('unchecked', async (name: string) => `hello ${name}`);
