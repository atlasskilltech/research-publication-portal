/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // middleware.js runs on every /api/* request, and Next buffers the body of a
    // request that passes through middleware — by default only the first 10 MB,
    // which would cut off manuscript uploads (25 MB) and achievement uploads
    // (up to 5 files × 10 MB). Each route still enforces its own Content-Length
    // limit before reading the body.
    middlewareClientMaxBodySize: "60mb",
  },
};

export default nextConfig;
