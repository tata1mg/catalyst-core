import { API } from './app.ts';

const DOG_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%23e8f1ff'/%3E%3Ccircle cx='160' cy='108' r='54' fill='%237a4f2a'/%3E%3Ccircle cx='137' cy='96' r='8' fill='%23000'/%3E%3Ccircle cx='183' cy='96' r='8' fill='%23000'/%3E%3Cpath d='M140 132q20 18 40 0' stroke='%23000' stroke-width='8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E";

const DOG_BREEDS = {
  affenpinscher: [],
  beagle: [],
  boxer: [],
  bulldog: ['boston', 'english', 'french'],
  chihuahua: [],
  dalmatian: [],
  doberman: [],
  husky: [],
  labrador: [],
  malamute: [],
  pug: [],
  retriever: ['golden'],
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
};

const send = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const { hostname, port } = new URL(API);
Bun.serve({
  hostname,
  port: Number(port),
  routes: {
    '/api/breeds/list/all': {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      GET: () => send({ message: DOG_BREEDS, status: 'success' }),
    },
    '/api/breed/:breed/images': {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      GET: () => send({ message: [DOG_SVG], status: 'success' }),
    },
  },
});
console.log(`server.ts listening on ${API}`);
