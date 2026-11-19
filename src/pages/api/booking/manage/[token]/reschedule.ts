import type { APIRoute } from 'astro';
import { getContext } from '../../../../../server/context';
import { rescheduleHandler } from '../../../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = async ({ request, params, clientAddress }) => rescheduleHandler(request, await getContext(), params, clientAddress);
