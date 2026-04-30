// One-off cleanup for old anonymous-feedback notifications:
//   1. NULL out actorId on every "feedback" notification — they should
//      always be anonymous, but earlier versions may have stamped the
//      submitter's id. Without this, the inbox renders the submitter's
//      initial (e.g. the purple "S") which leaks identity.
//   2. Migrate the old title prefix "New anonymous feedback — X" to
//      "New anonymous feedback received — X" so existing entries match
//      the new wording shown to recipients going forward.
//
// Run:  npx tsx scripts/_fix-anon-feedback-notifs.ts

import { PrismaClient } from "@prisma/client";

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
    const prisma = new PrismaClient({ datasources: { db: { url } } });

    try {
        const cleared = await prisma.notification.updateMany({
            where: { type: "feedback", actorId: { not: null } },
            data:  { actorId: null },
        });
        console.log(`Cleared actorId on ${cleared.count} feedback notification(s).`);

        const renamed = await prisma.$executeRawUnsafe(
            `UPDATE "Notification"
                SET title = REPLACE(title, 'New anonymous feedback — ', 'New anonymous feedback received — ')
              WHERE type = 'feedback'
                AND title LIKE 'New anonymous feedback —%'
                AND title NOT LIKE 'New anonymous feedback received —%';`
        );
        console.log(`Renamed title on ${renamed} feedback notification(s).`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
