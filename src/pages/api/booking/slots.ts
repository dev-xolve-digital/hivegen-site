import type { APIRoute } from 'astro';
import { slotsHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = withContext(slotsHandler);
