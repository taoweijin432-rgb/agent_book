import { readdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { safeFailure,requireCondition } from '../src/safety.mjs';

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'verification/design-task');
const excluded=new Set(['.git','node_modules','.pnpm-store','.cache','__pycache__']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const protectedPath=relative=>(relative.startsWith('docs/')&&!relative.startsWith('docs/16-'))
  ||relative.startsWith('prototypes/')||relative.startsWith('verification/foundation/')||relative==='db/migrations/001_foundation.mjs';
async function inventory(directory){const result={};
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(excluded.has(entry.name)||entry.isSymbolicLink()||['.DS_Store','.test-results.json'].includes(entry.name))continue;
    const absolute=path.join(directory,entry.name);
    if(entry.isDirectory())Object.assign(result,await inventory(absolute));
    else if(entry.isFile()&&protectedPath(path.relative(root,absolute)))result[path.relative(root,absolute)]=hash(await readFile(absolute));
  }return result;
}
try{
  const before=JSON.parse(await readFile(path.join(output,'protected-before.json'),'utf8')),after=await inventory(root);
  const keys=Object.keys(before).sort(),actual=Object.keys(after).sort();
  requireCondition(JSON.stringify(keys)===JSON.stringify(actual),'PROTECTED_FILE_SET_CHANGED');
  requireCondition(keys.every(key=>before[key]===after[key]),'PROTECTED_CONTENT_CHANGED');
  const aggregate=hash(JSON.stringify(keys.map(key=>[key,before[key]])));
  await writeFile(path.join(output,'protection-result.md'),`# 本轮受保护文件核验\n\n- 修改前独立基线：protected-before.json，在本轮实施前捕获；没有重新生成或覆盖第一批基线。\n- 重新枚举 ${keys.length} 个路径，文件集合与逐文件 SHA-256 全部相同。\n- 范围：docs/00—15、十三个原型及全部历史报告/修复证据、001_foundation.mjs、verification/foundation 全部历史记录。\n- 前后集合摘要（相同）：${aggregate}。\n- 排除依赖、缓存、临时结果与目录别名；不遍历 node_modules。\n- 本轮不执行 Git 暂存/提交/推送/reset/clean，不删除用户文件或历史归档。\n`);
  process.stdout.write(`${JSON.stringify({ok:true,protectedFiles:keys.length,setsEqual:true,sha256Equal:true})}\n`);
}catch(error){process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);process.exitCode=1;}
