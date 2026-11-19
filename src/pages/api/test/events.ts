import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { testEventsHandler } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = async ({ request, params, clientAddress }) => testEventsHandler(request, await getContext(), params, clientAddress);
