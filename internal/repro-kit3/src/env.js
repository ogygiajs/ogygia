import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_GREETING: {
		public: true,
		static: true,
		schema: (value) => value ?? 'hello from env'
	}
});
