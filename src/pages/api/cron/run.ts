import type { APIRoute } from 'astro';
import { cronHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(cronHandler);
