import { createLazyVercelHandler } from '../src/vercel-runtime.js';

const handler = createLazyVercelHandler();

export const maxDuration = 300;
export default handler;
