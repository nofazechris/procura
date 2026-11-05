import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// The repo keeps a single .env at the root (never committed). Next only reads its own folder.
// Existing process variables win, so real deployments (Vercel) are unaffected.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@procura/shared", "@procura/policies", "@procura/database", "@procura/procurement"],
  // Native/Node-only drivers stay out of the bundle.
  serverExternalPackages: ["ws", "pg"],
  poweredByHeader: false,
  // The pages were renamed to match the product. Old links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/procurement", destination: "/requests", permanent: true },
      { source: "/procurement/:path*", destination: "/requests/:path*", permanent: true },
      { source: "/suppliers", destination: "/sellers", permanent: true },
      { source: "/suppliers/:path*", destination: "/sellers/:path*", permanent: true },
      { source: "/settings/agent-permissions", destination: "/limits", permanent: true },
      { source: "/settings/:path*", destination: "/dashboard", permanent: true },
      { source: "/settings", destination: "/limits", permanent: true },
    ];
  },
};

export default config;
