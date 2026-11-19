import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { testOutboxHandler } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = async ({ request, params, clientAddress }) => testOutboxHandler(request, await getContext(), params, clientAddress);
