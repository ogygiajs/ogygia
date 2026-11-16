<!-- A router page that sets a context with ogygia's setter, as `createContext`'s set does. -->
<script lang="ts">
	import { setContext } from '../../src/context-bridge.ts';
	setContext(Symbol.for('router-page-theme'), 'forest');
</script>

<p data-sets-theme>theme</p>
