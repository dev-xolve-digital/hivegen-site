import type { APIRoute } from 'astro';
import { inquiriesHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(inquiriesHandler);
