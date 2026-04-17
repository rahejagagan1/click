import { PrismaClient } from "@prisma/client";

// Validate critical env vars at startup — fail fast in production
if (process.env.NODE_ENV === "production") {
    const required = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(`[Startup] Missing required environment variables: ${missing.join(", ")}`);
    }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

function isPrismaClientStale(client: PrismaClient | undefined): boolean {
  if (!client) return true;
  // After `prisma generate`, new models appear on the client class; a cached global
  // instance from before generate does not get them — leads to undefined.findMany.
  const c = client as unknown as {
    youtubeDashboardQuarterMetrics?: { findMany?: unknown };
    youtubeDashboardChannelQuarterAnalysis?: { findMany?: unknown };
  };
  return (
    typeof c.youtubeDashboardQuarterMetrics?.findMany !== "function" ||
    typeof c.youtubeDashboardChannelQuarterAnalysis?.findMany !== "function"
  );
}

/**
 * Resolve the singleton. In development, replaces the global instance when it was
 * created before `prisma generate` added new models (avoids undefined.findMany).
 */
function resolveClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    globalForPrisma.prisma ??= createPrismaClient();
    return globalForPrisma.prisma;
  }
  if (isPrismaClientStale(globalForPrisma.prisma)) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma!;
}

/**
 * In dev, a Proxy so every `prisma.*` access runs resolveClient() — module-level
 * `const prisma = resolveClient()` would stay stale across HMR after `prisma generate`.
 */
export const prisma: PrismaClient =
  process.env.NODE_ENV === "development"
    ? (new Proxy({} as PrismaClient, {
          get(_target, prop, receiver) {
            const client = resolveClient();
            const value = Reflect.get(client, prop, receiver);
            if (typeof value === "function") {
              return (value as (...args: unknown[]) => unknown).bind(client);
            }
            return value;
          },
      }) as PrismaClient)
    : resolveClient();

export default prisma;
