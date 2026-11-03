import { defineEnvVars } from '@sveltejs/kit/env';

// Kit 3 exposes only the variables declared here (via `$app/env/private`). All optional: the
// scenario deck sets the emulators' URLs (../../postrender.spec.ts), the order spec the hooks mode.
const optional = { schema: (value: string | undefined) => value };

export const variables = defineEnvVars({
	EDGE_AKAMAI_URL: optional,
	EDGE_CF_URL: optional,
	EDGE_SITE_URL: optional,
	POSTRENDER_HOOKS: optional
});
