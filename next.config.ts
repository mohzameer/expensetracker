import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) ships WASM that must not be bundled...
  serverExternalPackages: ["@electric-sql/pglite"],
  // ...and production uses Neon, so leave it out of the deployed functions (faster cold starts).
  outputFileTracingExcludes: { "*": ["node_modules/@electric-sql/pglite/**"] },
};

export default nextConfig;
