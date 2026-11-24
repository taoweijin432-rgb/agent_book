import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const entry = 'prototypes/projection-attempt-lifecycle/.test-results.json\n';

async function filesUnder(relative) {
  const result = [];
  for (const item of await readdir(path.join(repository, relative), { withFileTypes: true })) {
    if (item.name === 'node_modules') continue;
    const name = `${relative}/${item.name}`;
    if (item.isDirectory()) result.push(...await filesUnder(name));
    else if (item.isFile()) result.push(name);
  }
  return result;
}

const before = await readFile(path.join(directory, 'protected-sha256-before.txt'), 'utf8');
const expected = new Map(before.trimEnd().split('\n').map((line) => [line.slice(66), line.slice(0, 64)]));
const actualFiles = await filesUnder('docs');
for (const name of ['time-interval', 'evidence-candidate', 'evidence-canon', 'evidence-design', 'evidence-tool', 'evidence-unified']) {
  actualFiles.push(...await filesUnder(`prototypes/${name}-constraints`));
}
for (const item of await readdir(repository, { withFileTypes: true })) {
  if (item.isFile() && item.name !== '.gitignore') actualFiles.push(item.name);
}
actualFiles.sort();
const errors = [];
const actual = [];
for (const name of actualFiles) {
  const digest = sha(await readFile(path.join(repository, name)));
  actual.push(`${digest}  ${name}\n`);
  if (!expected.has(name)) errors.push(`新增受保护文件：${name}`);
  else if (expected.get(name) !== digest) errors.push(`哈希不符：${name}`);
}
for (const name of expected.keys()) if (!actualFiles.includes(name)) errors.push(`缺失受保护文件：${name}`);
await writeFile(path.join(directory, 'protected-sha256-after.txt'), actual.join(''));
const gitignoreBefore = await readFile(path.join(directory, 'gitignore-before.txt'));
const gitignoreAfter = await readFile(path.join(repository, '.gitignore'));
if (!gitignoreAfter.equals(Buffer.concat([gitignoreBefore, Buffer.from(entry)]))) errors.push('.gitignore 不等于原文加指定唯一条目');
await writeFile(path.join(directory, 'gitignore-before.sha256'), `${sha(gitignoreBefore)}  .gitignore\n`);
await writeFile(path.join(directory, 'gitignore-after.sha256'), `${sha(gitignoreAfter)}  .gitignore\n`);
await writeFile(path.join(directory, 'git-status-after.txt'), execFileSync('git', ['status', '--short'], { cwd: repository, encoding: 'utf8' }));
const lines = [
  `核验状态：${errors.length === 0 ? 'PASS' : 'FAIL'}`,
  `受保护文件：修改前 ${expected.size}；修改后 ${actualFiles.length}`,
  '保护范围：docs/00—15 全部文件；Time Interval、Candidate、Canon、Design、Tool、Unified Evidence 六个旧原型全部文件（排除 node_modules）；根文件（.gitignore 单独核验）',
  `逐文件 SHA-256、文件集合比较：${errors.length === 0 ? '全部一致' : '发现差异'}`,
  `.gitignore 原文完整保留，仅追加：${entry.trimEnd()}`,
  `新增字节数：${gitignoreAfter.length - gitignoreBefore.length}；预期：${Buffer.byteLength(entry)}`,
  'Git 状态已保存；本脚本仅执行 git status，不暂存、提交、推送、reset 或 clean。',
  ...errors,
];
await writeFile(path.join(directory, 'hash-validation.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
process.exitCode = errors.length === 0 ? 0 : 1;
