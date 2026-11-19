import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { leadsHandler } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, clientAddress }) => leadsHandler(request, await getContext(), params, clientAddress);
