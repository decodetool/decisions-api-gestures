import { createApp } from "../lib/api.mjs";

// Vercel invokes Express directly; it does not start the local Vite server.
export default createApp();
