/**
 * Seed the CM / Production Manager formula template.
 * Run: npx tsx scripts/seed-cm-template.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const YT_BRACKETS = [
    { min: 0,   max: 50,          stars: 1 },
    { min: 51,  max: 95,          stars: 2 },
    { min: 95,  max: 105,         stars: 3 },
    { min: 105, max: 200,         stars: 4 },
    { min: 201, max: 999_999_999, stars: 5 },
];

const QUALITY_BRACKETS = [
    { min: 0,  max: 29, stars: 1 },
    { min: 30, max: 34, stars: 2 },
    { min: 35, max: 39, stars: 3 },
    { min: 40, max: 44, stars: 4 },
    { min: 45, max: 50, stars: 5 },
];

const CM_DELIVERY_PCT_BRACKETS = [
    { min: 95, max: 100, stars: 5 },
    { min: 85, max: 94.999, stars: 4 },
    { min: 70, max: 84.999, stars: 3 },
    { min: 50, max: 69.999, stars: 2 },
    { min: 0, max: 49.999, stars: 1 },
];

const sections = [
    // ── Pillar 1: Views (15%) ──
    {
        key: "youtubeViews",
        label: "Views Performance",
        weight: 0.15,
        type: "yt_baseline_ratio",
        source: "youtube",
        yt_fallback_stars: 3,
        blocks_final_score: false,
        brackets: YT_BRACKETS,
        yt_manager_adjustment_key: "cm_yt_adjustment",
        description: "YouTube views of cases completed by your capsule (CM Check 4 done).",
    },

    // ── Pillar 2: Production Quality (15%) ──
    {
        key: "productionQuality",
        label: "Production Quality",
        weight: 0.15,
        type: "team_quality_avg",
        source: "clickup",
        variable: "cm_team_production_quality_avg",
        blocks_final_score: false,
        brackets: QUALITY_BRACKETS,
        description: "Average quality score across all writers and editors in your team for this month.",
        rating_criteria: {
            intro: "This pillar reflects the combined quality output of your team (writers + editors).",
            levels: [
                { stars: 5, bullets: ["Team avg quality score 45–50", "Consistently excellent output"] },
                { stars: 4, bullets: ["Team avg quality score 40–44", "High quality with minor gaps"] },
                { stars: 3, bullets: ["Team avg quality score 35–39", "Adequate quality"] },
                { stars: 2, bullets: ["Team avg quality score 30–34", "Below standard"] },
                { stars: 1, bullets: ["Team avg quality score below 30", "Significant issues"] },
            ],
        },
    },

    // ── Pillar 3: Monthly Targets (15%) — delivery % vs per-manager target ──
    {
        key: "monthlyTargets",
        label: "Monthly Targets",
        weight: 0.15,
        type: "bracket_lookup",
        source: "formula",
        variable: "cm_delivery_pct",
        qualify_threshold: 32,
        cm_delivery_hero_multiplier: 1.3,
        cm_delivery_default_multiplier: 1,
        cm_delivery_hero_case_type_labels: ["hero"],
        cm_delivery_target_by_manager_name: {},
        brackets: CM_DELIVERY_PCT_BRACKETS,
        blocks_final_score: true,
        description:
            "Weighted units (Hero ×1.3, other ×1) ÷ monthly target. Target from profile or cm_delivery_target_by_manager_name. Case type = ClickUp Case.caseType.",
    },

    // ── Pillar 4: Leadership & Team Management (15%) ──
    {
        key: "leadership",
        label: "Leadership & Team Management",
        weight: 0.15,
        type: "manager_questions_avg",
        source: "manager",
        question_keys: ["cm_leadership_q1", "cm_leadership_q2", "cm_leadership_q3", "cm_leadership_q4", "cm_leadership_q5"],
        question_labels: [
            "Team motivation & morale management",
            "Task delegation & workload balance",
            "Conflict resolution & problem solving",
            "Mentoring & skill development of team",
            "Accountability & ownership of outcomes",
        ],
        blocks_final_score: true,
        description: "Evaluates leadership capabilities in managing and developing the production team.",
        rating_criteria: {
            intro: "This pillar evaluates how effectively the CM/PM leads, motivates, and develops their team.",
            levels: [
                { stars: 5, bullets: ["Team consistently motivated", "Perfect workload distribution", "Proactively resolves conflicts", "Active mentoring", "Full ownership"] },
                { stars: 4, bullets: ["Team generally motivated", "Good delegation", "Handles conflicts effectively", "Regular skill development", "Strong accountability"] },
                { stars: 3, bullets: ["Average morale", "Adequate delegation", "Resolves conflicts when escalated", "Basic mentoring", "Takes responsibility"] },
                { stars: 2, bullets: ["Low morale", "Uneven workload", "Slow to address conflicts", "Limited development support", "Deflects accountability"] },
                { stars: 1, bullets: ["Team disengaged", "Poor delegation", "Ignores conflicts", "No mentoring", "Avoids accountability"] },
            ],
        },
    },

    // ── Pillar 5: Team Feedback (15%) — 50% manager + 50% team ──
    {
        key: "teamFeedback",
        label: "Team Feedback & Collaboration",
        weight: 0.15,
        type: "combined_team_manager_rating",
        source: "manager",
        manager_question_keys: ["cm_collab_mgr_q1", "cm_collab_mgr_q2", "cm_collab_mgr_q3", "cm_collab_mgr_q4", "cm_collab_mgr_q5"],
        manager_question_labels: [
            "Cross-team collaboration effectiveness",
            "Openness to feedback & suggestions",
            "Communication clarity with team",
            "Support during challenging situations",
            "Fair treatment & inclusivity",
        ],
        team_question_keys: ["cm_collab_team_q1", "cm_collab_team_q2", "cm_collab_team_q3", "cm_collab_team_q4", "cm_collab_team_q5"],
        team_question_labels: [
            "How well does your manager collaborate across teams?",
            "How open is your manager to feedback?",
            "How clear is communication from your manager?",
            "How supportive is your manager during challenges?",
            "How fair and inclusive is your manager?",
        ],
        team_question_options: [
            ["Poor", "Fair", "Excellent"],
            ["Rarely", "Sometimes", "Always"],
            ["Very unclear", "Mostly clear", "Very clear"],
            ["Not supportive", "Somewhat supportive", "Very supportive"],
            ["Not fair / inclusive", "Mixed", "Fair & inclusive"],
        ],
        blocks_final_score: true,
        description: "Combined rating: 50% from senior management + 50% from team members' anonymous feedback.",
        manager_rating_criteria: {
            intro: "From a leadership perspective: rate how this CM/PM collaborates, listens, communicates with the team, and shows up in tough moments.",
            levels: [
                { stars: 5, bullets: ["Drives strong cross-team alignment", "Actively seeks and acts on feedback", "Communication is consistently clear and timely", "Highly supportive under pressure", "Fair, inclusive, and consistent with the team"] },
                { stars: 4, bullets: ["Good collaboration with occasional gaps", "Generally receptive to feedback", "Clear communication with minor misses", "Supportive in most situations", "Mostly fair and inclusive"] },
                { stars: 3, bullets: ["Adequate cross-team coordination", "Accepts feedback when raised", "Communication is acceptable but uneven", "Supportive when asked", "Mixed perceptions of fairness"] },
                { stars: 2, bullets: ["Weak cross-team collaboration", "Defensive or slow to accept feedback", "Unclear or inconsistent communication", "Limited support in challenges", "Fairness concerns raised"] },
                { stars: 1, bullets: ["Collaboration breakdowns across teams", "Dismisses or rejects feedback", "Poor communication with the team", "Absent or counterproductive under pressure", "Team feels treated unfairly"] },
            ],
        },
        team_rating_criteria: {
            intro: "Your answers are anonymous. Use the same 1–5 scale: how strongly you agree that each statement reflects your manager this month.",
            levels: [
                { stars: 5, bullets: ["I see excellent collaboration across teams", "My manager genuinely welcomes my input", "I always understand priorities and expectations", "I feel supported when work is hard", "I feel respected and included"] },
                { stars: 4, bullets: ["Collaboration is strong most of the time", "My manager is open to feedback overall", "Communication is clear with rare gaps", "I usually feel backed by my manager", "I generally feel treated fairly"] },
                { stars: 3, bullets: ["Collaboration is okay but inconsistent", "Feedback is heard sometimes", "Communication is hit-or-miss", "Support depends on the situation", "Fairness feels uneven"] },
                { stars: 2, bullets: ["Collaboration is weak from my view", "Hard to give feedback safely", "I'm often unclear on direction", "I rarely feel supported", "I often feel overlooked or unfairly treated"] },
                { stars: 1, bullets: ["Cross-team work feels blocked", "Feedback is ignored or punished", "Communication is confusing or absent", "I don't feel supported at all", "I feel excluded or mistreated"] },
            ],
        },
        team_pillar_team_rules_enabled: true,
        team_pillar_zero_below_team_avg: 2,
        team_pillar_cap_below_team_avg: 3,
        team_pillar_cap_max_stars: 3.5,
    },

    // ── Pillar 6: Strategic Thinking (10%) ──
    {
        key: "strategicThinking",
        label: "Strategic Thinking & Planning",
        weight: 0.10,
        type: "manager_questions_avg",
        source: "manager",
        question_keys: ["cm_strategy_q1", "cm_strategy_q2", "cm_strategy_q3", "cm_strategy_q4", "cm_strategy_q5"],
        question_labels: [
            "Content strategy & trend awareness",
            "Proactive planning & pipeline management",
            "Data-driven decision making",
            "Innovation & creative problem solving",
            "Long-term vision for team/channel growth",
        ],
        blocks_final_score: true,
        description: "Evaluates strategic thinking about content, growth, and team development.",
        rating_criteria: {
            intro: "This pillar measures strategic capability — planning, trend awareness, data usage, and vision.",
            levels: [
                { stars: 5, bullets: ["Ahead of trends", "Robust pipeline", "Data-driven", "Innovative", "Clear growth roadmap"] },
                { stars: 4, bullets: ["Good trend awareness", "Well-managed pipeline", "Uses data mostly", "Occasionally innovative", "Has growth plan"] },
                { stars: 3, bullets: ["Aware of basic trends", "Adequate pipeline", "Some data usage", "Standard approaches", "Basic planning"] },
                { stars: 2, bullets: ["Behind on trends", "Reactive pipeline", "Minimal data", "No innovation", "Short-term only"] },
                { stars: 1, bullets: ["Unaware of trends", "No pipeline planning", "Arbitrary decisions", "Resists change", "No vision"] },
            ],
        },
    },

    // ── Pillar 7: Communication & Reporting (15%) ──
    {
        key: "communication",
        label: "Communication & Reporting",
        weight: 0.15,
        type: "manager_questions_avg",
        source: "manager",
        question_keys: ["cm_comm_q1", "cm_comm_q2", "cm_comm_q3", "cm_comm_q4", "cm_comm_q5"],
        question_labels: [
            "Timeliness & accuracy of reports",
            "Upward communication (escalations & updates)",
            "Downward communication (team briefings & clarity)",
            "Cross-functional communication",
            "Documentation & process adherence",
        ],
        blocks_final_score: true,
        description: "Evaluates communication effectiveness — reporting, escalation handling, team communication.",
        rating_criteria: {
            intro: "This pillar evaluates communication skills — upward, downward, and cross-functional.",
            levels: [
                { stars: 5, bullets: ["Reports always on time", "Proactive escalations", "Team well-informed", "Excellent cross-team comms", "Thorough docs"] },
                { stars: 4, bullets: ["Reports mostly on time", "Timely escalations", "Team generally informed", "Good cross-team comms", "Good docs"] },
                { stars: 3, bullets: ["Reports sometimes delayed", "Escalations sometimes late", "Adequate team comms", "Basic cross-team interaction", "Minimal docs"] },
                { stars: 2, bullets: ["Reports frequently delayed", "Late escalations", "Team often uninformed", "Poor cross-team comms", "Incomplete docs"] },
                { stars: 1, bullets: ["No regular reporting", "Fails to escalate", "Team left in dark", "No cross-team comms", "No docs"] },
            ],
        },
    },
];

async function main() {
    console.log("🔍 Checking for existing production_manager template...");

    const existing = await prisma.formulaTemplate.findFirst({
        where: { roleType: "production_manager", isActive: true },
    });

    if (existing) {
        console.log(`✅ Active template already exists: id=${existing.id}, v${existing.version}, "${existing.label}"`);
        console.log("   No action needed. To create a new version, deactivate this one first.");
        await prisma.$disconnect();
        return;
    }

    const latest = await prisma.formulaTemplate.findFirst({
        where: { roleType: "production_manager" },
        orderBy: { version: "desc" },
    });

    const nextVersion = (latest?.version ?? 0) + 1;

    console.log(`📝 Creating production_manager template v${nextVersion}...`);

    const template = await prisma.formulaTemplate.create({
        data: {
            roleType: "production_manager",
            version: nextVersion,
            isActive: true,
            label: `Production Manager / Channel Manager Monthly Rating v${nextVersion}`,
            description: "CM/PM rating: Views 15% · Production Quality 15% · Monthly Targets 15% · Leadership 15% · Team Feedback 15% · Strategic Thinking 10% · Communication 15%",
            sections: JSON.parse(JSON.stringify(sections)),
            guardrails: [],
            roundOff: false,
        },
    });

    // Deactivate any other templates for this role
    await prisma.formulaTemplate.updateMany({
        where: { roleType: "production_manager", id: { not: template.id } },
        data: { isActive: false },
    });

    console.log(`✅ Template created and activated!`);
    console.log(`   ID:      ${template.id}`);
    console.log(`   Version: ${template.version}`);
    console.log(`   Pillars: ${sections.length}`);
    console.log("");
    console.log("   Pillar breakdown:");
    for (const s of sections) {
        const pct = (s.weight * 100).toFixed(0);
        console.log(`   ${pct.padStart(3)}%  ${s.label} (${s.type})`);
    }
    console.log("");
    console.log("   ⭐ Pillar 5 (Team Feedback) uses combined_team_manager_rating:");
    console.log("      → 50% from manager rating (cm_collab_mgr_q1..q5)");
    console.log("      → 50% from team members' anonymous ratings (cm_collab_team_q1..q5)");

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error("❌ Error:", e);
    prisma.$disconnect();
    process.exit(1);
});
