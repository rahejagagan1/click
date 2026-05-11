import { PrismaClient } from "@prisma/client";

const DEV_URL = "postgresql://gagan:gagan180204@69.62.79.231:5432/nb_dashboard_dev";
const PROD_URL = "postgresql://gagan:gagan180204@69.62.79.231:5432/nb_dashboard";

const TABLES_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`;

async function listTables(url, label) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await client.$queryRawUnsafe(TABLES_SQL);
    return new Set(rows.map((r) => r.table_name));
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const [dev, prod] = await Promise.all([
    listTables(DEV_URL, "dev"),
    listTables(PROD_URL, "prod"),
  ]);

  const all = new Set([...dev, ...prod]);
  const onlyDev = [...all].filter((t) => dev.has(t) && !prod.has(t)).sort();
  const onlyProd = [...all].filter((t) => prod.has(t) && !dev.has(t)).sort();
  const both = [...all].filter((t) => dev.has(t) && prod.has(t)).sort();

  console.log(`DEV  table count: ${dev.size}`);
  console.log(`PROD table count: ${prod.size}`);
  console.log(`Common tables   : ${both.length}`);
  console.log("");
  console.log(`-- Tables only in DEV (${onlyDev.length}) --`);
  onlyDev.forEach((t) => console.log("  " + t));
  console.log("");
  console.log(`-- Tables only in PROD (${onlyProd.length}) --`);
  onlyProd.forEach((t) => console.log("  " + t));
  console.log("");
  console.log(`-- Tables in both (${both.length}) --`);
  both.forEach((t) => console.log("  " + t));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
