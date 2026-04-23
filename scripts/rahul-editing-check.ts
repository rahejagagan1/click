import prisma from "../src/lib/prisma";

async function main() {
    const subs = await prisma.subtask.findMany({
        where: {
            caseId: { in: [96, 102] },
            name: { contains: "editing", mode: "insensitive" },
        },
        select: { caseId: true, name: true, status: true, dateDone: true, dateCreated: true },
    });
    console.log(`Editing subtasks found on case #96 or #102: ${subs.length}`);
    for (const s of subs) {
        console.log(`  case #${s.caseId}  ${s.name}  [${s.status}]  done=${s.dateDone?.toISOString() ?? "NULL"}`);
    }
    if (subs.length === 0) {
        console.log("None synced in DB for these 2 cases.");
    }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
