import type { APIRoute } from 'astro';
import { eventsHandler, withContext } from '../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(eventsHandler);
