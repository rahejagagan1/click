import prisma from "../src/lib/prisma";

function fmt(d: Date | null | undefined): string {
    if (!d) return "—";
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

async function main() {
    const cases = await prisma.case.findMany({
        where: { name: { contains: "022607", mode: "insensitive" } },
        include: {
            editor:     { select: { id: true, name: true } },
            writer:     { select: { id: true, name: true } },
            researcher: { select: { id: true, name: true } },
            assignee:   { select: { id: true, name: true } },
            productionList: { select: { id: true, name: true } },
            subtasks: {
                orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
                include: { assignee: { select: { id: true, name: true } } },
            },
        },
    });

    if (cases.length === 0) {
        console.log("No case found matching '022607'");
        return;
    }

    for (const c of cases) {
        console.log("═".repeat(78));
        console.log(`Case #${c.id}  "${c.name}"`);
        console.log("─".repeat(78));
        console.log(`ClickUp task id   : ${c.clickupTaskId ?? "—"}`);
        console.log(`ClickUp URL       : ${c.clickupUrl ?? "—"}`);
        console.log(`Status            : ${c.status ?? "—"}  (type: ${c.statusType ?? "—"})`);
        console.log(`Production list   : ${c.productionList ? `${c.productionList.name} (#${c.productionList.id})` : "—"}`);
        console.log(`Date created      : ${fmt(c.dateCreated)}`);
        console.log(`Case start date   : ${fmt(c.caseStartDate)}`);
        console.log(`Date done         : ${fmt(c.dateDone)}`);
        console.log(`Case completion   : ${fmt(c.caseCompletionDate)}`);
        console.log(`Upload date       : ${fmt(c.uploadDate)}`);
        console.log(`Researcher        : ${c.researcher ? `${c.researcher.name} (#${c.researcher.id})` : "—"}`);
        console.log(`Writer            : ${c.writer ? `${c.writer.name} (#${c.writer.id})` : "—"}`);
        console.log(`Editor            : ${c.editor ? `${c.editor.name} (#${c.editor.id})` : "—"}`);
        console.log(`Assignee          : ${c.assignee ? `${c.assignee.name} (#${c.assignee.id})` : "—"}`);

        console.log(`\nSubtasks (${c.subtasks.length}):`);
        if (c.subtasks.length === 0) {
            console.log("   (none)");
        } else {
            for (const s of c.subtasks) {
                console.log("   ─".repeat(25));
                console.log(`   #${s.id}  ${s.name}`);
                console.log(`       clickup    : ${s.clickupTaskId}`);
                console.log(`       status     : ${s.status}  (type: ${s.statusType ?? "—"})`);
                console.log(`       assignee   : ${s.assignee ? `${s.assignee.name} (#${s.assignee.id})` : "—"}`);
                console.log(`       start      : ${fmt(s.startDate)}`);
                console.log(`       due        : ${fmt(s.dueDate)}`);
                console.log(`       done       : ${fmt(s.dateDone)}`);
                console.log(`       created    : ${fmt(s.dateCreated)}`);
                console.log(`       tat        : ${s.tat ?? "—"}`);
                console.log(`       orderIndex : ${s.orderIndex ?? "—"}`);
            }
        }
        console.log();
    }
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
