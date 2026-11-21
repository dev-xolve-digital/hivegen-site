import type { APIRoute } from 'astro';
import { configHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = withContext(configHandler);
