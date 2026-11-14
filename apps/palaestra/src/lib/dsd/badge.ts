if (typeof customElements !== 'undefined' && !customElements.get('x-badge'))
	customElements.define(
		'x-badge',
		class extends HTMLElement {
			connectedCallback(): void {
				this.setAttribute('data-up', '');
			}
		}
	);
