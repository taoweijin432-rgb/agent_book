import { createHash } from 'node:crypto';
import { readFile,readdir,realpath,stat,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const specification=JSON.parse(await readFile(path.join(here,'scope.json'),'utf8'));
const mutable=new Set(specification.mutable.map(name=>path.resolve(root,name)));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function enumerate(relative='',parents=new Set([root])){
  const result=[];
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
    const name=relative?`${relative}/${item.name}`:item.name;if(['.git','node_modules'].includes(item.name))continue;
    const physical=await realpath(path.join(root,name));
    if(physical===here||physical.startsWith(`${here}${path.sep}`)||mutable.has(physical))continue;
    const info=item.isSymbolicLink()?await stat(path.join(root,name)):item;
    if(info.isDirectory()){if(parents.has(physical))throw new Error('protected_link_cycle');result.push(...await enumerate(name,new Set([...parents,physical])));}
    else if(info.isFile())result.push(name);
  }return result;
}
const before=(await readFile(path.join(here,'protected-sha256-before.txt'),'utf8')).trimEnd().split('\n');
const expected=new Map(),errors=[];
for(const line of before){if(!/^[a-f0-9]{64}  .+$/.test(line)){errors.push('invalid_before_line');continue;}const name=line.slice(66);if(expected.has(name))errors.push(`duplicate_before:${name}`);expected.set(name,line.slice(0,64));}
const files=(await enumerate()).sort();if(files.length!==new Set(files).size)errors.push('duplicate_after');
const actual=[];
for(const name of files){const digest=sha(await readFile(path.join(root,name)));actual.push(`${digest}  ${name}\n`);if(!expected.has(name))errors.push(`added:${name}`);else if(expected.get(name)!==digest)errors.push(`changed:${name}`);}
for(const name of expected.keys())if(!files.includes(name))errors.push(`missing:${name}`);
await writeFile(path.join(here,'protected-sha256-after.txt'),actual.join(''));
await writeFile(path.join(here,'git-status-after.txt'),execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}));
const changed=[];for(const name of specification.mutable){const beforePath=path.join(here,'before',path.relative(path.join(root,'prototypes/authorization-safe-context'),path.join(root,name)));if(sha(await readFile(beforePath))!==sha(await readFile(path.join(root,name))))changed.push(name);}
const lines=[`核验状态：${errors.length?'FAIL':'PASS'}`,`本轮独立保护清单：修改前 ${before.length}；修改后 ${files.length}；不预设数量。`,
  '保护：正式 docs/00—15、十二个既有原型、当前运行器、工具网关、package.json、锁文件、根 .gitignore，以及当前原始保护清单/核验脚本和其他仓库文件。',
  '仅排除本轮六个许可修改路径及当前 audit-scope-repair 核验目录；旧缓存别名按真实路径作同样判断。排除 .git 与 node_modules。',
  `内容 SHA-256、路径新增/遗漏/重复检查：${errors.length?'FAIL':'PASS'}`,
  '原始 verification/protected-sha256-before.txt 未覆盖；本轮独立清单不替换历史基线。','Git 仅 status；没有暂存、提交、推送、reset 或 clean。',
  '', '六个许可路径中的实际内容改动：',...changed,'',...errors];
await writeFile(path.join(here,'hash-validation.txt'),lines.join('\n')+'\n');console.log(lines.join('\n'));process.exitCode=errors.length?1:0;
