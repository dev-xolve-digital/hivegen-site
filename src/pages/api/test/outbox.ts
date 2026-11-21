import type { APIRoute } from 'astro';
import { testOutboxHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = withContext(testOutboxHandler);
