const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // Average views per channel from YoutubeStats
  const stats = await p.$queryRaw`
    SELECT c.channel, 
           COUNT(*)::int as "videoCount",
           AVG(ys."viewCount")::bigint as "avgViews",
           MIN(ys."viewCount")::bigint as "minViews",
           MAX(ys."viewCount")::bigint as "maxViews",
           AVG(ys."last30DaysViews")::bigint as "avgFirst30"
    FROM "Case" c
    JOIN "YoutubeStats" ys ON ys."caseId" = c.id
    WHERE c.channel IS NOT NULL
    GROUP BY c.channel
    ORDER BY "videoCount" DESC
  `;
  
  console.log('=== YouTube Stats by Channel ===\n');
  for (const s of stats) {
    console.log(s.channel + ':');
    console.log('  Videos: ' + s.videoCount);
    console.log('  Avg total views: ' + s.avgViews);
    console.log('  Min views: ' + s.minViews);
    console.log('  Max views: ' + s.maxViews);
    console.log('  Avg first30 views: ' + (s.avgFirst30 || 'N/A'));
    console.log('');
  }

  // ChannelBaseline schema
  const cols = await p.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'ChannelBaseline'
    ORDER BY ordinal_position
  `;
  console.log('=== ChannelBaseline table schema ===');
  for (const col of cols) {
    console.log('  ' + col.column_name + ' (' + col.data_type + ')');
  }

  await p.$disconnect();
})();
