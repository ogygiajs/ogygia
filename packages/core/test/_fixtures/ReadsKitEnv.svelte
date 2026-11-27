<!-- A region whose client imports Kit's $app/env/public: it asks for the env as Region's seed ask would. -->
<script>
	import { record_page } from '../../src/page-seed-registry.ts';
	record_page({ data: {} }, false, [], '/islands/env.js', true);
</script>

<b data-reads-kit-env>env</b>
