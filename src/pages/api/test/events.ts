import type { APIRoute } from 'astro';
import { testEventsHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = withContext(testEventsHandler);
