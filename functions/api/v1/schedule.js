// Cloudflare Pages Functions route for /api/v1/schedule
import { onRequest as scheduleHandler } from '../schedule.js';

export async function onRequest(context) {
  return scheduleHandler(context);
}
