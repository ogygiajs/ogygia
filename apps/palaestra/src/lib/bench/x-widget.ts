// A web component library's element, as an inline classic script in <head>: it upgrades each
// `<x-widget>` while the parser reaches it, BEFORE Kit hydrates, and renders into its own light DOM
// (it wraps its children in a box and adds an icon). It counts its lifecycle on `window.__xw`.
// `?xw=static`: the element is defined but leaves its light DOM alone.
export const X_WIDGET_SCRIPT = `<script>
window.__xw = { connect: 0, disconnect: 0, construct: 0 };
const xw_static = location.search.includes('xw=static');
customElements.define('x-widget', class extends HTMLElement {
	constructor() { super(); window.__xw.construct++; }
	connectedCallback() {
		window.__xw.connect++;
		if (this.__rendered || xw_static) return;
		this.__rendered = true;
		const box = document.createElement('div');
		box.className = 'x-box';
		while (this.firstChild) box.appendChild(this.firstChild);
		const icon = document.createElement('span');
		icon.className = 'x-icon';
		icon.textContent = '*';
		this.append(icon, box);
	}
	disconnectedCallback() { window.__xw.disconnect++; }
});
</script>`;
