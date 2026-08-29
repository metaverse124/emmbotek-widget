/** Vercel serverless entrypoint: POST /api/sync (cron + webhook CMS) */
import { createSyncHandler } from '../src/server/handlers/sync.js';

export default createSyncHandler();
