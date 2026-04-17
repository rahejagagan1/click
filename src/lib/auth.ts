import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma";

const useDevLogin = process.env.NEXT_PUBLIC_DEV_LOGIN === "true";
const developerEmails = (process.env.DEVELOPER_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

/** Stable synthetic ClickUp id for dev-login users (must be unique per email). */
function devClickupUserIdFromEmail(email: string): bigint {
    let n = 0n;
    for (let i = 0; i < email.length; i++) {
        n = (n * 131n + BigInt(email.charCodeAt(i))) % 9_007_199_254_740_991n;
    }
    return n <= 0n ? 1n : n;
}

export const authOptions: NextAuthOptions = {
    providers: useDevLogin
        ? [
            // ─── Development: instant sign-in, no Google required ───
            CredentialsProvider({
                name: "Dev Login",
                credentials: {},
                async authorize() {
                    // Returns a mock admin user — auto-signed in on /login
                    return {
                        id: "dev",
                        name: "Dev Admin",
                        email: "dev@nbmediaproductions.com",
                        image: null,
                    };
                },
            }),
        ]
        : [
            // ─── Production: Google OAuth only ───
            GoogleProvider({
                clientId: process.env.GOOGLE_CLIENT_ID!,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            }),
        ],

    callbacks: {
        async signIn({ user, account }) {
            // In dev, always allow
            if (useDevLogin) return true;
            // Allow developer emails (from env) regardless of domain
            if (user.email && developerEmails.includes(user.email.toLowerCase())) {
                // Save developer to DB
                try {
                    await prisma.user.upsert({
                        where: { email: user.email },
                        create: {
                            email: user.email,
                            name: user.name || "Developer",
                            profilePictureUrl: user.image || null,
                            clickupUserId: BigInt(0),
                            role: "admin",
                            orgLevel: "special_access",
                        },
                        update: {
                            name: user.name || undefined,
                            profilePictureUrl: user.image || undefined,
                        },
                    });
                } catch (e) {
                    console.error("Failed to upsert developer user:", e);
                }
                return true;
            }
            // Only allow users that already exist in the DB and are active
            if (!user.email) return false;
            const existingUser = await prisma.user.findUnique({
                where: { email: user.email },
                select: { isActive: true },
            });
            if (!existingUser) {
                return false; // User not in DB — must be added via admin first
            }
            if (!existingUser.isActive) {
                return false; // User was deactivated — block login
            }
            // Update profile picture on login
            try {
                await prisma.user.update({
                    where: { email: user.email },
                    data: {
                        name: user.name || undefined,
                        profilePictureUrl: user.image || undefined,
                    },
                });
            } catch (e) {
                console.error("Failed to update user on login:", e);
            }
            return true;
        },

        async jwt({ token, user }) {
            if (token.email) {
                try {
                    const dbUser = await prisma.user.findUnique({
                        where: { email: token.email },
                        select: { id: true, role: true, orgLevel: true },
                    });
                    if (dbUser) {
                        token.dbId = dbUser.id;
                        token.role = dbUser.role;
                        token.orgLevel = dbUser.orgLevel;
                    }
                    if (developerEmails.includes(token.email.toLowerCase())) {
                        token.isDeveloper = true;
                        token.orgLevel = "ceo";
                    }
                } catch {}
            }
            // Credentials dev login: middleware reads JWT only — must match session `isDeveloper` for developer-only routes (e.g. YouTube dashboard).
            if (useDevLogin && token.email) {
                (token as any).isDeveloper = true;
            }
            return token;
        },

        async session({ session }) {
            if (session.user?.email) {
                try {
                    const dbUser = await prisma.user.findUnique({
                        where: { email: session.user.email },
                        select: {
                            id: true,
                            clickupUserId: true,
                            role: true,
                            orgLevel: true,
                            teamCapsule: true,
                            name: true,
                            profilePictureUrl: true,
                        },
                    });
                    if (dbUser) {
                        // Set critical fields first — before any BigInt conversion that could throw
                        (session.user as any).dbId = dbUser.id;
                        (session.user as any).role = dbUser.role;
                        (session.user as any).orgLevel = dbUser.orgLevel;
                        (session.user as any).teamCapsule = dbUser.teamCapsule;
                        (session.user as any).dbName = dbUser.name;
                        // BigInt conversion isolated — null clickupUserId must not wipe out dbId
                        try {
                            (session.user as any).clickupUserId = dbUser.clickupUserId != null
                                ? dbUser.clickupUserId.toString()
                                : "0";
                        } catch {
                            (session.user as any).clickupUserId = "0";
                        }
                    } else if (useDevLogin && session.user.email) {
                        // Dev credentials login: ensure a DB row exists so APIs (e.g. feedback) get dbId + orgLevel
                        // Upsert may fail if the generated clickupUserId hash collides with an existing user's unique ID.
                        // In that case, fall back to a plain findUnique.
                        const devSelect = {
                            id: true,
                            clickupUserId: true,
                            role: true,
                            orgLevel: true,
                            teamCapsule: true,
                            name: true,
                            profilePictureUrl: true,
                        } as const;
                        let devRow: any = null;
                        try {
                            devRow = await prisma.user.upsert({
                                where: { email: session.user.email },
                                create: {
                                    email: session.user.email,
                                    name: session.user.name || "Dev Admin",
                                    profilePictureUrl: session.user.image ?? null,
                                    clickupUserId: devClickupUserIdFromEmail(session.user.email),
                                    role: "admin",
                                    orgLevel: "ceo",
                                },
                                update: {
                                    name: session.user.name || undefined,
                                    profilePictureUrl: session.user.image ?? undefined,
                                },
                                select: devSelect,
                            });
                        } catch {
                            // Unique constraint collision on clickupUserId — user may already exist, look them up
                            devRow = await prisma.user.findUnique({
                                where: { email: session.user.email },
                                select: devSelect,
                            }).catch(() => null);
                        }
                        if (devRow) {
                            (session.user as any).dbId = devRow.id;
                            (session.user as any).role = devRow.role;
                            (session.user as any).orgLevel = devRow.orgLevel;
                            (session.user as any).teamCapsule = devRow.teamCapsule;
                            (session.user as any).dbName = devRow.name;
                            try {
                                (session.user as any).clickupUserId = devRow.clickupUserId != null
                                    ? devRow.clickupUserId.toString()
                                    : "0";
                            } catch {
                                (session.user as any).clickupUserId = "0";
                            }
                        }
                    }
                    // Developer access from env — full access
                    if (session.user?.email && developerEmails.includes(session.user.email.toLowerCase())) {
                        (session.user as any).isDeveloper = true;
                        (session.user as any).orgLevel = "ceo"; // Full visibility
                    }
                    // Dev credentials login: same developer-only UI as production DEVELOPER_EMAILS (YouTube dashboard, etc.)
                    if (useDevLogin && session.user?.email) {
                        (session.user as any).isDeveloper = true;
                    }
                } catch {
                    if (useDevLogin) (session.user as any).role = "admin";
                }
            }
            return session;
        },
    },

    pages: {
        signIn: "/login",
    },

    secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
};
