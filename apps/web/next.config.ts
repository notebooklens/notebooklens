import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers() {
    return Promise.resolve([
      {
        // The sandboxed interactive output renderer assets. `frame-ancestors`
        // must be a real HTTP response header (it is silently ignored inside
        // a <meta http-equiv="Content-Security-Policy"> tag), and
        // Subresource Integrity on bundle.js requires a CORS-visible
        // response because the requesting document has an opaque origin
        // (sandbox="allow-scripts" without allow-same-origin).
        source: "/interactive-renderer/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ]);
  },
};

export default nextConfig;
