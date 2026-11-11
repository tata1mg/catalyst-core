import type { Answer, Result, Sources } from './app.contract.d.ts';

export const API = import.meta.env.API_BASE_URL;
export const grants = `net.fetch ${API}`;

const BREEDS: Result<'loadBreeds'> = [
  { id: 'affenpinscher', name: 'affenpinscher' },
  { id: 'beagle', name: 'beagle' },
  { id: 'boxer', name: 'boxer' },
  { id: 'bulldog', name: 'bulldog' },
  { id: 'chihuahua', name: 'chihuahua' },
  { id: 'dalmatian', name: 'dalmatian' },
  { id: 'doberman', name: 'doberman' },
  { id: 'husky', name: 'husky' },
  { id: 'labrador', name: 'labrador' },
  { id: 'malamute', name: 'malamute' },
  { id: 'pug', name: 'pug' },
  { id: 'retriever', name: 'retriever' },
];

type BreedPayload = Result<'loadBreedDetails'>;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

const sources: Sources = {
  loadBreeds: async () => BREEDS,
  loadBreedDetails: async ([breed]): Promise<BreedPayload> => {
    if (!breed) return { breed: '', dogs: [] };
    const response = await fetch(`${API}/api/breed/${encodeURIComponent(breed)}/images`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const images = isStringArray(body?.message) ? body.message : [];
    return {
      breed,
      dogs: images.slice(0, 8).map((imageUrl, idx) => ({
        id: `${breed}-${idx + 1}`,
        imageUrl,
        label: `${breed} #${idx + 1}`,
        age: `Age: ${(idx % 10) + 1} years`,
      })),
    };
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
