import type { APIRoute } from 'astro';
import { testResetHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const POST: APIRoute = withContext(testResetHandler);
