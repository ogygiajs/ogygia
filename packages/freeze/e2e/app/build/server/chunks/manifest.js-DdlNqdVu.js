const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.D17tN5fI.js",app:"_app/immutable/entry/app.CF6RwPix.js",imports:["_app/immutable/entry/start.D17tN5fI.js","_app/immutable/chunks/C82MoFHZ.js","_app/immutable/chunks/C3DqmHOU.js","_app/immutable/chunks/h7YPRWw_.js","_app/immutable/entry/app.CF6RwPix.js","_app/immutable/chunks/C3DqmHOU.js","_app/immutable/chunks/6zCZ8NgT.js","_app/immutable/chunks/B095bM6r.js","_app/immutable/chunks/C82MoFHZ.js","_app/immutable/chunks/h7YPRWw_.js","_app/immutable/chunks/CRzLMJPS.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-3FGCjDGm.js')),
			__memo(() => import('./nodes/1.js-Cbn_-V5d.js')),
			__memo(() => import('./nodes/2.js-DPkGv0KW.js')),
			__memo(() => import('./nodes/3.js-COn4_LDq.js')),
			__memo(() => import('./nodes/4.js-CtJY0tHc.js')),
			__memo(() => import('./nodes/5.js-CdagXy48.js')),
			__memo(() => import('./nodes/6.js-UJxDFkLm.js')),
			__memo(() => import('./nodes/7.js-DfSkZ7EJ.js')),
			__memo(() => import('./nodes/8.js-C7OJpShF.js')),
			__memo(() => import('./nodes/9.js-g2n9h7FT.js')),
			__memo(() => import('./nodes/10.js-RMhdWTYU.js')),
			__memo(() => import('./nodes/11.js-CubN8nd6.js')),
			__memo(() => import('./nodes/12.js-jC47A8HW.js')),
			__memo(() => import('./nodes/13.js-CrJwK3RX.js')),
			__memo(() => import('./nodes/14.js-3bJZ9tav.js'))
		],
		remotes: {
			'16icjp9': __memo(() => import('./chunks/remote-16icjp9.js-DRLcLqD6.js'))
		},
		routes: [
			{
				id: "/api/publish",
				pattern: /^\/api\/publish\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/publish/_server.ts.js-CmqIyt5D.js'))
			},
			{
				id: "/api/state",
				pattern: /^\/api\/state\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/state/_server.ts.js-DlnOE6NM.js'))
			},
			{
				id: "/api/user",
				pattern: /^\/api\/user\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/user/_server.ts.js-Dlz6HGVC.js'))
			},
			{
				id: "/spa",
				pattern: /^\/spa\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 14 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/act",
				pattern: /^\/([^/]+?)\/([^/]+?)\/act\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/consent",
				pattern: /^\/([^/]+?)\/([^/]+?)\/consent\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/c/[slug]",
				pattern: /^\/([^/]+?)\/([^/]+?)\/c\/([^/]+?)\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false},{"name":"slug","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/esi",
				pattern: /^\/([^/]+?)\/([^/]+?)\/esi\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/flagged",
				pattern: /^\/([^/]+?)\/([^/]+?)\/flagged\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/hole",
				pattern: /^\/([^/]+?)\/([^/]+?)\/hole\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/live-header",
				pattern: /^\/([^/]+?)\/([^/]+?)\/live-header\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/optout",
				pattern: /^\/([^/]+?)\/([^/]+?)\/optout\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/redirect-me",
				pattern: /^\/([^/]+?)\/([^/]+?)\/redirect-me\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/setcookie",
				pattern: /^\/([^/]+?)\/([^/]+?)\/setcookie\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/stitched",
				pattern: /^\/([^/]+?)\/([^/]+?)\/stitched\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 12 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/stream",
				pattern: /^\/([^/]+?)\/([^/]+?)\/stream\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 13 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

export { manifest as m };
//# sourceMappingURL=manifest.js-DdlNqdVu.js.map
