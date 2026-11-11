import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

const INFO: Result<'loadInfo'> = {
  title: 'Error Catalog App',
};

const sources: Sources = {
  loadInfo: async () => INFO,
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
