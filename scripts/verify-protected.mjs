import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedFiles } from './verification-support.mjs';
import { requireCondition, safeFailure } from '../src/safety.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'verification/foundation');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
const allowedRoot=new Set(['README.md','package.json','pnpm-lock.yaml','config.example.json','provision.example.json']);
const appended=Buffer.from('\n# Local foundation connection and provisioning credentials\n*.local.json\n');

try {
  const before=JSON.parse(await readFile(path.join(output,'protected-before.json'),'utf8'));
  const current=await protectedFiles(root);
  for(const key of Object.keys(before.files).filter(key=>!key.startsWith('docs/')&&!key.startsWith('prototypes/'))) {
    current[key]=hash(await readFile(path.join(root,key)));
  }
  requireCondition(JSON.stringify(sorted(current))===JSON.stringify(sorted(before.files)),'PROTECTED_FILE_DIFFERENCE');
  const original=Buffer.from(before.gitignoreBeforeBase64,'base64');
  const ignore=await readFile(path.join(root,'.gitignore'));
  requireCondition(ignore.equals(Buffer.concat([original,appended])),'GITIGNORE_NOT_MINIMAL');
  const sourceFiles=[];
  async function list(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(['.git','node_modules','.pnpm-store','.cache','__pycache__'].includes(entry.name)||entry.isSymbolicLink()||entry.name==='.DS_Store')continue;
      const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute);
      if(entry.isDirectory())await list(absolute);
      else if(entry.isFile()&&!Object.hasOwn(before.files,relative)){
        requireCondition(allowedRoot.has(relative)||relative==='.gitignore'||relative==='docs/16-prototype-consolidation-and-implementation-plan.md'
          ||['src/','db/','scripts/','test/','verification/foundation/'].some(prefix=>relative.startsWith(prefix)),'UNEXPECTED_NEW_FILE');
        sourceFiles.push(relative);
      }
    }
  }
  await list(root);
  const aggregate=hash(JSON.stringify(sorted(current)));
  const result=`# 第一批受保护文件核验\n\n- 修改前基线：protected-before.json，在实现前捕获，不重建基线。\n- 保护路径：${Object.keys(current).length}；重新枚举集合及 SHA-256 全部相同。\n- 覆盖 docs/00—15、十三个原型（含原报告/迁移/测试/运行器/锁文件）及既有根归档；排除依赖、缓存、临时文件，不跟随目录缓存别名。\n- 前后集合聚合 SHA-256：${aggregate}（相同）。\n- 根 .gitignore 等于原字节加唯一的本轮 *.local.json 规则块（${appended.length} 字节）；未删除旧规则。\n- 其余原有可改文件仅 DOC-16；新增文件全部位于本任务允许范围。\n- 无 Git 暂存/提交/推送/reset/clean；未删除用户文件或历史归档。\n`;
  await writeFile(path.join(output,'protection-result.md'),result);
  for(const relative of ['verification/foundation/protection-result.md','verification/foundation/file-manifest.md'])if(!sourceFiles.includes(relative))sourceFiles.push(relative);
  sourceFiles.sort();
  await writeFile(path.join(output,'file-manifest.md'),`# 第一批实际文件清单\n\n仅 .gitignore 与 DOC-16 为原有文件修改，其余为新增。依赖安装目录与本轮临时凭据/结果不计入交付。\n\n${sourceFiles.map(file=>`- [${file}](../../${file})`).join('\n')}\n`);
  process.stdout.write(`${JSON.stringify({ok:true,protectedPaths:Object.keys(current).length,deliveredFiles:sourceFiles.length})}\n`);
} catch(error){process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);process.exitCode=1;}
