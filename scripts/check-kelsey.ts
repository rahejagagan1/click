import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
(function(){const p=resolve(process.cwd(),".env");if(!existsSync(p))return;for(const l of readFileSync(p,"utf8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e===-1)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}})();
import prisma from "../src/lib/prisma";
(async()=>{
  const c = await prisma.case.findUnique({
    where:{clickupTaskId:"86d2jj1qx"},
    include:{subtasks:{orderBy:{orderIndex:"asc"},select:{name:true,status:true,dateDone:true}}}
  });
  if(!c){console.log("NOT IN DB");return;}
  console.log(`Case #${c.id} "${c.name}" — ${c.subtasks.length} subtasks:`);
  for(const s of c.subtasks) console.log(`  ${s.name.padEnd(30)}  ${s.status}  done=${s.dateDone?.toISOString()??"—"}`);
  await prisma.$disconnect();
})();
