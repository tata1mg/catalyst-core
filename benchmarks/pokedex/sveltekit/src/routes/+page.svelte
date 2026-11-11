<svelte:head><title>Pokédex</title></svelte:head>
<script>
	let { data } = $props();
	let q = $state('');
	let type = $state('');
	const types = [...new Set(data.pokemon.flatMap((p) => p.types))].sort();
	const shown = $derived(data.pokemon.filter((p) => p.name.includes(q.trim().toLowerCase()) && (!type || p.types.includes(type))));
</script>
<div class="container">
	<h1>Pokédex</h1>
	<div class="controls">
		<input type="search" aria-label="Search Pokémon" placeholder="Search by name" bind:value={q} />
		<select aria-label="Filter by type" bind:value={type}>
			<option value="">All types</option>
			{#each types as t (t)}<option value={t}>{t}</option>{/each}
		</select>
	</div>
	<ul class="grid">
		{#each shown as p, i (p.id)}
			<li>
				<a href={`/pokemon/${p.name}`} class="card" data-testid={p.name}>
					<img src={`http://localhost:4000/sprites/${p.id}.png`} width="96" height="96" alt={p.name} loading={i < 6 ? 'eager' : 'lazy'} />
					<div class="num">#{String(p.id).padStart(3, '0')}</div>
					<div class="name">{p.name}</div>
					{#each p.types as t (t)}<span class="badge">{t}</span>{/each}
				</a>
			</li>
		{/each}
	</ul>
</div>
