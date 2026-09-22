// Cloudflare Pages Functions route for /watch
import { onRequest as middlewareHandler } from './_middleware.js';

export async function onRequest(context) {
  return middlewareHandler(context);
}
