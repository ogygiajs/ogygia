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
		client: {start:"_app/immutable/entry/start.CBHOfXv8.js",app:"_app/immutable/entry/app.CMZOVlCv.js",imports:["_app/immutable/entry/start.CBHOfXv8.js","_app/immutable/chunks/C3ap9kEj.js","_app/immutable/chunks/BD1c5Kbx.js","_app/immutable/chunks/DH5JoSNV.js","_app/immutable/chunks/XKyaHtl9.js","_app/immutable/chunks/7gTSoQIJ.js","_app/immutable/chunks/RNeBOKcO.js","_app/immutable/entry/app.CMZOVlCv.js","_app/immutable/chunks/XKyaHtl9.js","_app/immutable/chunks/BD1c5Kbx.js","_app/immutable/chunks/CRxmSgyX.js","_app/immutable/chunks/DH5JoSNV.js","_app/immutable/chunks/7gTSoQIJ.js","_app/immutable/chunks/RNeBOKcO.js","_app/immutable/chunks/DqoMOBQD.js","_app/immutable/chunks/CRzLMJPS.js","_app/immutable/chunks/BE16lb9k.js","_app/immutable/chunks/BPTG7Frf.js","_app/immutable/chunks/Cqi6syEB.js","_app/immutable/chunks/BtedWSNX.js","_app/immutable/chunks/C3ap9kEj.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js-DwbnBdVT.js')),
			__memo(() => import('./nodes/1.js-Dx5UJyTt.js')),
			__memo(() => import('./nodes/3.js-zFfB-ptw.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/island-pkg",
				pattern: /^\/island-pkg\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/rtr/[...path]",
				pattern: /^\/rtr(?:\/([^]*))?\/?$/,
				params: [{"name":"path","optional":false,"rest":true,"chained":true}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/rtr/_...path_/_server.ts.js-CWBKwGcp.js'))
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
//# sourceMappingURL=manifest.js-Bm2Tm6Xi.js.map
