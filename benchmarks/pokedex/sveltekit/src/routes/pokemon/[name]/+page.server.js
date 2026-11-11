import all from '$lib/pokemon.json';
import { error } from '@sveltejs/kit';
export const load = ({ params }) => {
	const p = all.find((x) => x.name === params.name);
	if (!p) error(404, 'Not found');
	return p;
};
