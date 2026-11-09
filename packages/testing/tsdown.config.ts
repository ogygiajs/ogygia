import { library } from '@ogygia/config/tsdown';

export default library({
	// Playwright's types only (`import type`): nothing of it reaches the build
	external: [/^@playwright\/test(\/|$)/]
});
