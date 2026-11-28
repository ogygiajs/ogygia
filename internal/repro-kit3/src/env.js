import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_GREETING: {
		public: true,
		static: true,
		schema: (value) => value ?? 'hello from env'
	},
	PUBLIC_REGION_NAME: {
		public: true,
		static: false,
		schema: (value) => value ?? 'region from env'
	}
});
