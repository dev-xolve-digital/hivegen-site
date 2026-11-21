import type { APIRoute } from 'astro';
import { leadsHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(leadsHandler);
