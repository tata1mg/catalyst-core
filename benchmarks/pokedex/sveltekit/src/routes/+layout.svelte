<script>
	import '../app.css';
	let { children } = $props();
</script>
<header class="site"><a href="/">Pokédex</a></header>
<main>{@render children()}</main>
