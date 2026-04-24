/** @type {import('next').NextConfig} */
const nextConfig = {
    // Optimize large library imports for smaller bundles
    experimental: {
        optimizePackageImports: ["recharts", "lru-cache"],
    },
    // Reduce powered-by header for security
    poweredByHeader: false,
    // Enable compression
    compress: true,
    // Log fetch details in dev for debugging slow API calls
    logging: {
        fetches: {
            fullUrl: true,
        },
    },

    async headers() {
        return [
            {
                // Security headers on all routes
                source: "/(.*)",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "X-Frame-Options",         value: "DENY" },
                    { key: "X-XSS-Protection",        value: "1; mode=block" },
                    { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
                    {
                        // `geolocation=(self)` lets our own origin use the
                        // geolocation API (required for attendance clock-in);
                        // camera/mic remain disabled. Any other origin is
                        // still blocked because they're not listed.
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=(self)",
                    },
                ],
            },
            {
                // Logo is static; cache aggressively so repeat visits don’t wait on the network
                source: "/logo.png",
                headers: [
                    { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
                ],
            },
            {
                // CORS for API routes — restrict to same origin (can set ALLOWED_ORIGIN env var)
                source: "/api/(.*)",
                headers: [
                    {
                        key: "Access-Control-Allow-Origin",
                        value: process.env.ALLOWED_ORIGIN || "same-origin",
                    },
                    { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
                    { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
                ],
            },
        ];
    },
};

export default nextConfig;
