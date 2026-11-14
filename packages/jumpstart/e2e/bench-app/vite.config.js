import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { jumpstart } from '@ogygia/jumpstart';
import { defineConfig } from 'vite';

// JUMPSTART=1 lists jumpstart(), JUMPSTART_EXTERNAL=a,b gives it `external` (../fixture.ts)
const external = (process.env.JUMPSTART_EXTERNAL || '').split(',').filter(Boolean);

export default defineConfig({
	plugins: [ogygia(), ...(process.env.JUMPSTART ? [jumpstart({ external })] : []), sveltekit()]
});
