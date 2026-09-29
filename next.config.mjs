/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    // Keep server-only DB packages out of the webpack bundle (loaded from node_modules at runtime).
    serverComponentsExternalPackages: ["@libsql/client", "sql.js", "firebase-admin", "@google-cloud/firestore"],
    outputFileTracingIncludes: {
      "/*": ["./src/lib/assets/sql-wasm.wasm", "./node_modules/sql.js/dist/sql-wasm.wasm"],
    },
  },
  images: {
    unoptimized: false,
  },
};

export default nextConfig;
