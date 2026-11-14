import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { jumpstart } from '@ogygia/jumpstart';
import { defineConfig } from 'vite';

// JUMPSTART=1 lists jumpstart(). JUMPSTART_STRICT=1 sets Rolldown's strictExecutionOrder on the
// server build, with no jumpstart: the canary for rolldown/rolldown#11702 (../canary.spec.ts)
/** @type {import('vite').Plugin} */
const strict = {
	name: 'jumpstart-e2e:strict-order',
	configEnvironment(name) {
		if (name === 'ssr')
			return { build: { rolldownOptions: { output: { strictExecutionOrder: true } } } };
	}
};

export default defineConfig({
	plugins: [
		ogygia(),
		...(process.env.JUMPSTART ? [jumpstart()] : []),
		...(process.env.JUMPSTART_STRICT ? [strict] : []),
		sveltekit()
	]
});
