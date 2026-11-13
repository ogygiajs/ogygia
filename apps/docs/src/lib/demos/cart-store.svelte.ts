import { createContext } from 'ogygia';

/** Live cart that crosses island boundaries as a prop (`static wire = import.meta.og.wire(…)`). */
export class Cart {
	items = $state<string[]>([]);

	get count() {
		return this.items.length;
	}

	add(item: string) {
		this.items.push(item);
	}

	static wire = import.meta.og.wire({
		encode: (c: Cart) => $state.snapshot(c.items),
		decode: (items: string[]) => Object.assign(new Cart(), { items })
	});
}

/** The same live `Cart`, set once above instead of drilled as a prop through every region. */
export const [getCart, setCart] = createContext<Cart>('docs-cart');
