import type { APIRoute } from 'astro';
import { bookingsHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(bookingsHandler);
