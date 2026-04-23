/**
 * One-off: list all users with role = writer or editor.
 * Usage: npx tsx scripts/list-writers-editors.ts
 */
import prisma from "../src/lib/prisma";

async function main() {
    const users = await prisma.user.findMany({
        where: { role: { in: ["writer", "editor"] } },
        select: {
            id: true, name: true, email: true, role: true, isActive: true,
            manager: { select: { id: true, name: true } },
            teamCapsule: true,
        },
        orderBy: [{ role: "asc" }, { isActive: "desc" }, { name: "asc" }],
    });

    const writers = users.filter((u) => u.role === "writer");
    const editors = users.filter((u) => u.role === "editor");

    const print = (label: string, list: typeof users) => {
        console.log(`\n${label} (${list.length})`);
        console.log("─".repeat(80));
        for (const u of list) {
            const flag = u.isActive ? "   " : "(X)";
            const mgr  = u.manager?.name ? ` → ${u.manager.name}` : "";
            const cap  = u.teamCapsule ? ` [${u.teamCapsule}]` : "";
            console.log(`${flag} #${String(u.id).padStart(4)}  ${u.name ?? "(no name)"}  <${u.email ?? "-"}>${mgr}${cap}`);
        }
    };

    print("WRITERS", writers);
    print("EDITORS", editors);
    console.log(`\nTotal: ${writers.length} writers, ${editors.length} editors (active and inactive).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
