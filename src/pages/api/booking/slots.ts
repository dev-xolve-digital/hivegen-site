import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { slotsHandler } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = async ({ request, params, clientAddress }) => slotsHandler(request, await getContext(), params, clientAddress);
