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
		client: {start:"_app/immutable/entry/start.BjocTVtb.js",app:"_app/immutable/entry/app.CTko0Q9_.js",imports:["_app/immutable/entry/start.BjocTVtb.js","_app/immutable/chunks/C4Bl5W83.js","_app/immutable/chunks/C3DqmHOU.js","_app/immutable/chunks/h7YPRWw_.js","_app/immutable/entry/app.CTko0Q9_.js","_app/immutable/chunks/C3DqmHOU.js","_app/immutable/chunks/6zCZ8NgT.js","_app/immutable/chunks/bu9cMg08.js","_app/immutable/chunks/C4Bl5W83.js","_app/immutable/chunks/h7YPRWw_.js","_app/immutable/chunks/CRzLMJPS.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-3FGCjDGm.js')),
			__memo(() => import('./nodes/1.js-DkM1zZFd.js')),
			__memo(() => import('./nodes/2.js-CbbL8dh3.js')),
			__memo(() => import('./nodes/3.js-emen7ShQ.js')),
			__memo(() => import('./nodes/4.js-Di3OO7SM.js')),
			__memo(() => import('./nodes/5.js-DBuWVLfF.js')),
			__memo(() => import('./nodes/6.js-BKmcrSyz.js')),
			__memo(() => import('./nodes/7.js-B6MgLKkk.js')),
			__memo(() => import('./nodes/8.js-Dkxr_OPS.js')),
			__memo(() => import('./nodes/9.js-dmMOUsze.js')),
			__memo(() => import('./nodes/10.js-60_LDifh.js')),
			__memo(() => import('./nodes/11.js-CtxuJYTe.js')),
			__memo(() => import('./nodes/12.js-ax382imr.js')),
			__memo(() => import('./nodes/13.js-PETrusMl.js')),
			__memo(() => import('./nodes/14.js-wlPGpNBe.js')),
			__memo(() => import('./nodes/15.js-BowRp4Di.js')),
			__memo(() => import('./nodes/16.js-B29uPnhp.js')),
			__memo(() => import('./nodes/17.js-CgcdoAl-.js'))
		],
		remotes: {
			'16icjp9': __memo(() => import('./chunks/remote-16icjp9.js-uBXe24GG.js'))
		},
		routes: [
			{
				id: "/api/publish",
				pattern: /^\/api\/publish\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/publish/_server.ts.js-ClvX5OCj.js'))
			},
			{
				id: "/api/state",
				pattern: /^\/api\/state\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/state/_server.ts.js-tLbfAUmX.js'))
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
				page: { layouts: [0,], errors: [1,], leaf: 17 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/act",
				pattern: /^\/([^/]+?)\/([^/]+?)\/act\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/consent",
				pattern: /^\/([^/]+?)\/([^/]+?)\/consent\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/c/[slug]",
				pattern: /^\/([^/]+?)\/([^/]+?)\/c\/([^/]+?)\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false},{"name":"slug","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/esi",
				pattern: /^\/([^/]+?)\/([^/]+?)\/esi\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/flagged",
				pattern: /^\/([^/]+?)\/([^/]+?)\/flagged\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/hole",
				pattern: /^\/([^/]+?)\/([^/]+?)\/hole\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/live-header",
				pattern: /^\/([^/]+?)\/([^/]+?)\/live-header\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/optout",
				pattern: /^\/([^/]+?)\/([^/]+?)\/optout\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/quiet",
				pattern: /^\/([^/]+?)\/([^/]+?)\/quiet\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,2,], errors: [1,,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/quiet/loud",
				pattern: /^\/([^/]+?)\/([^/]+?)\/quiet\/loud\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,2,], errors: [1,,], leaf: 12 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/redirect-me",
				pattern: /^\/([^/]+?)\/([^/]+?)\/redirect-me\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 13 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/setcookie",
				pattern: /^\/([^/]+?)\/([^/]+?)\/setcookie\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 14 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/stitched",
				pattern: /^\/([^/]+?)\/([^/]+?)\/stitched\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 15 },
				endpoint: null
			},
			{
				id: "/[lang]/[region]/stream",
				pattern: /^\/([^/]+?)\/([^/]+?)\/stream\/?$/,
				params: [{"name":"lang","optional":false,"rest":false,"chained":false},{"name":"region","optional":false,"rest":false,"chained":false}],
				page: { layouts: [0,], errors: [1,], leaf: 16 },
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
//# sourceMappingURL=manifest.js-CK5VNTyk.js.map
