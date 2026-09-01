/** Vercel serverless entrypoint: GET /api/token */
import { createTokenHandler } from '../src/server/handlers/token.js';

export default createTokenHandler();
