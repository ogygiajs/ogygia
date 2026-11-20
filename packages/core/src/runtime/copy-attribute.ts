/** Set `attr`, an attribute the HTML parser read, on `el`, under any name the parser takes. */
export function copy_attribute(el: Element, attr: Attr): void {
	try {
		el.setAttribute(attr.name, attr.value);
	} catch {
		// @why setAttribute refused names the parser takes (`-panel`, `@click`, `:class`) in engines before the DOM's 2025 relaxed names; setAttributeNode never checks the name (test: test/browser/morph-attribute-names.test.ts › a render with an attribute name the parser takes but an older setAttribute refuses still morphs in, whole)
		el.setAttributeNode(attr.cloneNode() as Attr);
	}
}
