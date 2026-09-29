/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client", "sql.js"],
    outputFileTracingIncludes: {
      "/*": ["./src/lib/assets/sql-wasm.wasm", "./node_modules/sql.js/dist/sql-wasm.wasm"],
    },
  },
  images: {
    unoptimized: false,
  },
};

export default nextConfig;
