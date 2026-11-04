import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// The repo keeps a single .env at the root (see .env.example). Next only reads its own folder.
// Existing process variables win, so real deployments (Vercel) are unaffected.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@procura/shared", "@procura/policies", "@procura/database", "@procura/procurement"],
  // Native/Node-only drivers stay out of the bundle.
  serverExternalPackages: ["ws", "pg"],
  poweredByHeader: false,
};

export default config;
