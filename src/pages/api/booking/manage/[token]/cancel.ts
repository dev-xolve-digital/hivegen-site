import type { APIRoute } from 'astro';
import { getContext } from '../../../../../server/context';
import { cancelHandler } from '../../../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, clientAddress }) => cancelHandler(request, await getContext(), params, clientAddress);
