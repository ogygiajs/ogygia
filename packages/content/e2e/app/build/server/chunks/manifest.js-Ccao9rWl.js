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
		client: {start:"_app/immutable/entry/start.CjINBQC2.js",app:"_app/immutable/entry/app.D2S3Noe2.js",imports:["_app/immutable/entry/start.CjINBQC2.js","_app/immutable/chunks/BCLW5U-U.js","_app/immutable/chunks/CQFN0avQ.js","_app/immutable/chunks/UUMwhdnX.js","_app/immutable/chunks/XKyaHtl9.js","_app/immutable/chunks/CH-p_bub.js","_app/immutable/chunks/RNeBOKcO.js","_app/immutable/entry/app.D2S3Noe2.js","_app/immutable/chunks/XKyaHtl9.js","_app/immutable/chunks/CQFN0avQ.js","_app/immutable/chunks/DhGVv6D7.js","_app/immutable/chunks/UUMwhdnX.js","_app/immutable/chunks/CH-p_bub.js","_app/immutable/chunks/RNeBOKcO.js","_app/immutable/chunks/BtWC0fJw.js","_app/immutable/chunks/CRzLMJPS.js","_app/immutable/chunks/BE16lb9k.js","_app/immutable/chunks/BPTG7Frf.js","_app/immutable/chunks/U7RmwNP4.js","_app/immutable/chunks/BdNcBqPr.js","_app/immutable/chunks/BCLW5U-U.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-HtcwAwez.js')),
			__memo(() => import('./nodes/1.js-C_ElrrFU.js')),
			__memo(() => import('./nodes/3.js-C1WpWU2X.js')),
			__memo(() => import('./nodes/4.js-C0zhg0x7.js')),
			__memo(() => import('./nodes/5.js-BPjwQRay.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/blocks-direct",
				pattern: /^\/blocks-direct\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/blocks",
				pattern: /^\/blocks\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/content-css",
				pattern: /^\/content-css\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
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
//# sourceMappingURL=manifest.js-Ccao9rWl.js.map
