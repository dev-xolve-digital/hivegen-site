import type { APIRoute } from 'astro';
import { rescheduleHandler, withContext } from '../../../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(rescheduleHandler);
