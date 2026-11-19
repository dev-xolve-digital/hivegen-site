import type { APIRoute } from 'astro';
import { cancelHandler, withContext } from '../../../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(cancelHandler);
