import type { APIRoute } from 'astro';
import { videoHandler, withContext } from '../../../server/http/handlers';

export const prerender = false;
export const GET: APIRoute = withContext(videoHandler);
