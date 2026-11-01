// src/lib/blocks/pages/landing.json
var meta = { "title": "Blocks landing" };
var blocks = [
	{
		"type": "Hero",
		"props": {
			"title": "Built from JSON",
			"tagline": "Server-only registry, page never imports a block"
		}
	},
	{
		"type": "Grid",
		"children": [
			{
				"type": "Feature",
				"props": {
					"title": "Fast",
					"body": "HTML only"
				}
			},
			{
				"type": "Feature",
				"props": {
					"title": "Typed",
					"body": "registry maps type to component"
				}
			},
			{
				"type": "Feature",
				"props": {
					"title": "Selective",
					"body": "only named blocks ship"
				}
			}
		]
	},
	{
		"type": "CtaCounter",
		"props": { "start": 3 }
	}
];
var landing_default = {
	meta,
	blocks
};

export { blocks, landing_default as default, meta };
//# sourceMappingURL=landing.js-CeLJbROE.js.map
