const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // Pick a writer from Feb 2026 (older month = more videos > 30 days old)
  const monthStart = new Date('2026-02-01');
  const monthEnd = new Date('2026-02-28');

  // Find subtasks (Scripting) completed in this window
  const subtasks = await p.subtask.findMany({
    where: {
      name: { contains: 'Scripting', mode: 'insensitive' },
      status: { in: ['done', 'complete', 'closed'] },
      dateDone: { gte: monthStart, lte: monthEnd },
    },
    select: { caseId: true },
  });

  const caseIds = [...new Set(subtasks.map(s => s.caseId))];
  console.log(`Found ${caseIds.length} cases with completed Scripting subtasks in Feb 2026\n`);

  if (caseIds.length === 0) {
    console.log('No cases found. Trying January...');
    await p.$disconnect();
    return;
  }

  // Get cases with YT stats, grouped by writer
  const cases = await p.case.findMany({
    where: { id: { in: caseIds } },
    select: {
      id: true,
      title: true,
      channel: true,
      writerUserId: true,
      editorUserId: true,
      youtubeStats: {
        select: {
          videoId: true,
          viewCount: true,
          last30DaysViews: true,
          publishedAt: true,
        }
      },
      writer: { select: { id: true, name: true, role: true } },
    },
  });

  // Group by writer
  const byWriter = {};
  for (const c of cases) {
    if (!c.writerUserId) continue;
    if (!byWriter[c.writerUserId]) {
      byWriter[c.writerUserId] = { name: c.writer?.name, cases: [] };
    }
    byWriter[c.writerUserId].cases.push(c);
  }

  // Find a writer with the most YT-linked cases
  let bestWriterId = null;
  let bestCount = 0;
  for (const [wId, data] of Object.entries(byWriter)) {
    const ytCount = data.cases.filter(c => c.youtubeStats).length;
    if (ytCount > bestCount) {
      bestCount = ytCount;
      bestWriterId = wId;
    }
  }

  if (!bestWriterId) {
    console.log('No writer found with YT data');
    await p.$disconnect();
    return;
  }

  const writer = byWriter[bestWriterId];
  console.log('=============================================');
  console.log('EXAMPLE: ' + writer.name + ' (userId ' + bestWriterId + ')');
  console.log('MONTH: February 2026');
  console.log('Total cases: ' + writer.cases.length);
  console.log('Cases with YT: ' + writer.cases.filter(c => c.youtubeStats).length);
  console.log('=============================================\n');

  // Channel baselines
  const baselines = await p.channelBaseline.findMany();
  const baselineMap = {};
  console.log('Channel Baselines:');
  if (baselines.length === 0) {
    console.log('  (EMPTY — no baselines in DB)\n');
  } else {
    for (const b of baselines) {
      baselineMap[b.channel] = Number(b.baselineViews);
      console.log('  ' + b.channel + ': ' + b.baselineViews);
    }
    console.log('');
  }

  // Walk through each case exactly like the formula engine
  const now = new Date();
  const fallbackStars = 3;
  const brackets = [
    { min: 0, max: 99, stars: 3 },
    { min: 100, max: 149, stars: 3.5 },
    { min: 150, max: 199, stars: 4 },
    { min: 199, max: 249, stars: 4.5 },
    { min: 250, max: 999999999, stars: 5 },
  ];

  function applyBrackets(ratio, bkts) {
    for (const b of bkts) {
      if (ratio >= b.min && ratio <= b.max) return b.stars;
    }
    return fallbackStars;
  }

  console.log('--- STEP-BY-STEP CALCULATION ---\n');
  const ytPerCaseRatios = [];
  const caseStarsList = [];

  for (const c of writer.cases) {
    const yt = c.youtubeStats;
    console.log(`Case #${c.id} "${c.title || c.channel}" — channel: ${c.channel}`);

    if (!yt) {
      console.log('  → No YouTube stats → SKIPPED (not counted)\n');
      continue;
    }

    console.log(`  YouTube: views=${yt.viewCount}, last30=${yt.last30DaysViews}, pub=${yt.publishedAt?.toISOString().slice(0,10) || 'N/A'}`);

    if (!yt.publishedAt) {
      console.log('  → No publish date → FALLBACK ${fallbackStars}★\n');
      ytPerCaseRatios.push({ ratio: null, isDefault: true });
      caseStarsList.push(fallbackStars);
      continue;
    }

    const daysSince = Math.floor((now.getTime() - new Date(yt.publishedAt).getTime()) / (1000*60*60*24));
    console.log(`  Days since publish: ${daysSince}`);

    if (daysSince < 30) {
      console.log(`  → Less than 30 days → FALLBACK ${fallbackStars}★\n`);
      ytPerCaseRatios.push({ ratio: null, isDefault: true });
      caseStarsList.push(fallbackStars);
      continue;
    }

    const baseline = baselineMap[c.channel];
    if (!baseline || baseline === 0) {
      console.log(`  → No baseline for channel "${c.channel}" → SKIPPED (not counted)\n`);
      continue;
    }

    const views = yt.last30DaysViews !== null
      ? Number(yt.last30DaysViews.toString())
      : Number(yt.viewCount?.toString() ?? '0');

    const ratio = (views / baseline) * 100;
    const stars = applyBrackets(ratio, brackets);

    console.log(`  → Views used: ${views} / Baseline: ${baseline} = ${ratio.toFixed(1)}% → ${stars}★\n`);
    ytPerCaseRatios.push({ ratio, isDefault: false });
    caseStarsList.push(stars);
  }

  console.log('=== FINAL CALCULATION ===\n');

  if (caseStarsList.length === 0) {
    console.log(`ytPerCaseRatios is EMPTY → Default fallback: ${fallbackStars}★`);
    console.log(`\nFinal YT Views Pillar: ${fallbackStars}★ × 30% weight = ${(fallbackStars * 0.30).toFixed(2)} contribution to overall score`);
  } else {
    console.log('Per-case stars: [' + caseStarsList.join(', ') + ']');
    const avg = caseStarsList.reduce((a, b) => a + b, 0) / caseStarsList.length;
    console.log(`Average: ${avg.toFixed(4)}`);

    // Check for manager adjustment
    const mRating = await p.monthlyRating.findFirst({
      where: { userId: Number(bestWriterId), month: monthStart },
      select: { managerRatingsJson: true }
    });

    let adj = 0;
    if (mRating?.managerRatingsJson?.youtube_adjustment) {
      adj = Number(mRating.managerRatingsJson.youtube_adjustment);
      console.log(`Manager adjustment: ${adj > 0 ? '+' : ''}${adj}`);
    } else {
      console.log('Manager adjustment: none');
    }

    const adjustedAvg = avg + adj;
    // customRound: round to nearest 0.5
    const rounded = Math.round(adjustedAvg * 2) / 2;
    console.log(`Adjusted average: ${adjustedAvg.toFixed(4)} → rounded to nearest 0.5 → ${rounded}★`);
    console.log(`\nFinal YT Views Pillar: ${rounded}★ × 30% weight = ${(rounded * 0.30).toFixed(2)} contribution to overall score`);
  }

  await p.$disconnect();
})();
