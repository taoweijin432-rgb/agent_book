import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const prototype = 'prototypes/canon-text-supersession';
const entry = `${prototype}/.test-results.json\n`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function protectedFiles(relative = '', ancestors = new Set([repository])) {
  const result = [];
  for (const item of await readdir(path.join(repository, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${item.name}` : item.name;
    if (['.git', 'node_modules'].includes(item.name) || name === prototype) continue;
    const resolved = await realpath(path.join(repository,name));
    const prototypePath = path.join(repository,prototype);
    if (resolved === prototypePath || resolved.startsWith(`${prototypePath}${path.sep}`)) continue;
    const info = item.isSymbolicLink() ? await stat(path.join(repository,name)) : item;
    if (info.isDirectory()) {
      if (ancestors.has(resolved)) throw new Error(`符号链接循环：${name}`);
      result.push(...await protectedFiles(name, new Set([...ancestors,resolved])));
    } else if (info.isFile() && name !== '.gitignore') result.push(name);
  }
  return result;
}
const errors = [];
const before = await readFile(path.join(directory, 'protected-sha256-before.txt'), 'utf8');
const lines = before.trimEnd().split('\n');
const expected = new Map();
for (const line of lines) {
  if (!/^[a-f0-9]{64}  .+$/.test(line)) { errors.push('修改前清单存在无效行'); continue; }
  const name = line.slice(66);
  if (expected.has(name)) errors.push(`修改前重复路径：${name}`);
  expected.set(name, line.slice(0,64));
}
const files = (await protectedFiles()).sort();
if (files.length !== new Set(files).size) errors.push('修改后存在重复路径');
const actual = [];
for (const name of files) {
  const digest = sha(await readFile(path.join(repository, name)));
  actual.push(`${digest}  ${name}\n`);
  if (!expected.has(name)) errors.push(`新增受保护文件：${name}`);
  else if (expected.get(name) !== digest) errors.push(`受保护内容不符：${name}`);
}
for (const name of expected.keys()) if (!files.includes(name)) errors.push(`遗漏受保护文件：${name}`);
await writeFile(path.join(directory, 'protected-sha256-after.txt'), actual.join(''));
const ignoreBefore = await readFile(path.join(directory, 'gitignore-before.txt'));
const ignoreAfter = await readFile(path.join(repository, '.gitignore'));
if (!ignoreAfter.equals(Buffer.concat([ignoreBefore, Buffer.from(entry)]))) errors.push('.gitignore 不等于原字节加指定唯一行');
await writeFile(path.join(directory, 'gitignore-before.sha256'), `${sha(ignoreBefore)}  .gitignore\n`);
await writeFile(path.join(directory, 'gitignore-after.sha256'), `${sha(ignoreAfter)}  .gitignore\n`);
await writeFile(path.join(directory, 'git-status-after.txt'), execFileSync('git', ['status', '--short'], { cwd: repository, encoding: 'utf8' }));
const report = [
  `核验状态：${errors.length ? 'FAIL' : 'PASS'}`,
  `受保护文件：修改前 ${lines.length} 个路径；修改后 ${files.length} 个路径`,
  '范围：docs/00—15、全部十一个既有原型（含 canon-structured-mapping）、根依赖及其他仓库文件；排除 .git、node_modules 和本轮新增目录（含指向它的缓存别名）；按修改前口径跟随旧缓存符号链接。',
  `前后 SHA-256 与路径集合比较：${errors.length ? '发现差异' : '全部一致'}`,
  `新增、遗漏、重复路径检查：${errors.length ? '见错误' : '通过'}`,
  `.gitignore 精确追加：${entry.trimEnd()}`,
  `新增字节数：${ignoreAfter.length-ignoreBefore.length}；预期 ${Buffer.byteLength(entry)}`,
  '仅运行 git status；没有暂存、提交、推送、reset 或 clean。', ...errors,
];
await writeFile(path.join(directory, 'hash-validation.txt'), `${report.join('\n')}\n`);
console.log(report.join('\n'));
process.exitCode = errors.length ? 1 : 0;
