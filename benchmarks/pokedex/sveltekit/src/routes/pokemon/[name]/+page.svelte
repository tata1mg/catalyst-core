<script>
	let { data } = $props();
</script>
<svelte:head><title>{data.name}</title></svelte:head>
<div class="container">
	<a href="/" class="back">← All Pokémon</a>
	<h1 style="text-transform: capitalize">{data.name} <span class="num">#{data.id}</span></h1>
	<img src={`http://localhost:4000/sprites/${data.id}.png`} width="96" height="96" alt={data.name} />
	<p>{#each data.types as t (t)}<span class="badge">{t}</span>{/each} · {data.height / 10} m · {data.weight / 10} kg</p>
	<div class="cols">
		<section><h2>Moves</h2><ul class="chips">{#each data.moves as m (m)}<li>{m}</li>{/each}</ul></section>
		<section><h2>Games</h2><ul class="chips">{#each data.games as g (g)}<li>{g}</li>{/each}</ul></section>
	</div>
</div>
