import type { APIRoute } from 'astro';
import { testCalendarHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(testCalendarHandler);
