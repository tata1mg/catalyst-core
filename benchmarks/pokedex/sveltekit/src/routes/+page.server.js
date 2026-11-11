import all from '$lib/pokemon.json';
export const load = () => ({ pokemon: all.map(({ id, name, types }) => ({ id, name, types })) });
