import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { configHandler } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = async ({ request, params, clientAddress }) => configHandler(request, await getContext(), params, clientAddress);
