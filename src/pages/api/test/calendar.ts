import type { APIRoute } from 'astro';
import { getContext } from '../../../server/context';
import { testCalendarHandler } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, clientAddress }) => testCalendarHandler(request, await getContext(), params, clientAddress);
