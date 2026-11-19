import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { testResetHandler } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, clientAddress }) => testResetHandler(request, await getContext(), params, clientAddress);
