import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { bookingsHandler } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, clientAddress }) => bookingsHandler(request, await getContext(), params, clientAddress);
