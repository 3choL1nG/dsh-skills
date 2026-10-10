#!/usr/bin/env node
/**
 * DSH 云同步助手（Windows / macOS / Linux 通用）
 * ---------------------------------------------------------------
 * 同一个工具管两套东西，互不干扰：
 *
 *   ① 技能库（默认，--unit 省略）
 *      目录：~/.agents/skills（Windows: C:\Users\你\.agents\skills）
 *      做法：把这个目录搬进 <同步文件夹>/skills，原位置留一个"链接"指回去。
 *            DSH 察觉不到，照常读技能；Git 同步的是同步文件夹里的真实文件。
 *      清单：SKILLS.md（每次自动重建）
 *
 *   ② 知识库（--unit kb）
 *      目录：D:\KB（Windows）/ ~/KB（macOS）
 *      做法：同上，搬进 <同步文件夹>/kb，原位置留链接。
 *      清单：INDEX.md 由你自己维护（全局导航表）；子库里的 _清单.md 由工具刷新。
 *      注意：_private/ 和 _work/ 两个子目录永远不上传（放敏感或临时文件用）。
 *
 * 日常只有两件事：改完东西【保存并上传】，换设备前【拉取更新】。
 *
 * 多端规则（并集）：Windows 上装了 A、B、C，Mac 上装了 B、D，
 * 同步完成后两边都会变成 A、B、C、D，清单也按并集重新生成。
 * 只有"两台设备改了同一个文件"才会需要你手工挑一下。
 *
 * 直接双击 同步助手.cmd / 知识库助手.cmd（macOS 是 .command），
 * 也可以命令行：node skills-sync.mjs [--unit kb]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(TOOL_DIR, 'settings.json');
const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();
const HOST = os.hostname();
const USER = (() => {
  try { return os.userInfo().username; } catch { return process.env.USERNAME || process.env.USER || 'user'; }
})();

const TOOL_SUBDIR = '_sync-tool';    // 本工具自己也会复制一份进技能库，方便 Mac 端直接用

// ───────────────────────────────────────────────────────── 两套"同步单元"（技能库 / 知识库）
// 逻辑完全一样，只是目录、仓库子目录、清单形式不同。--unit kb 切到知识库。

const UNITS = {
  skills: {
    key: 'skills',
    label: '技能',
    dirLabel: '技能目录',
    catalogName: 'SKILLS.md',
    catalogMode: 'skills',            // 自动生成技能清单
    sub: 'skills',                    // 仓库里的子目录
    shipsTool: true,                  // 仓库里带一份本工具
    defaultRoot: IS_WIN ? 'D:\\DSH-Skills' : path.join(HOME, 'DSH-Skills'),
    live: () => args['skills-dir'] || path.join(args.home || HOME, '.agents', 'skills'),
  },
  kb: {
    key: 'kb',
    label: '知识库',
    dirLabel: '知识库目录',
    catalogName: 'INDEX.md',
    catalogMode: 'inventory',         // 刷新各子库的 _清单.md，INDEX.md 由人维护
    sub: 'kb',
    shipsTool: false,
    defaultRoot: IS_WIN ? 'D:\\KB-Sync' : path.join(HOME, 'KB-Sync'),
    live: () => args['kb-dir'] || (IS_WIN ? 'D:\\KB' : path.join(HOME, 'KB')),
  },
};

function unit() { return UNITS[args.unit === 'kb' ? 'kb' : 'skills']; }

// 知识库模式下把提示语里的"技能"自动换成"知识库/内容"，这样同一套逻辑两边都读得通
const KB_WORDS = [
  ['把技能搬进', '把知识库搬进'],
  ['克隆技能库并接管', '克隆知识库并接管'],
  ['技能库的 GitHub 地址（https://…/dsh-skills.git）', '知识库的 GitHub 地址（https://…/dsh-kb.git）'],
  ['技能目录', '知识库目录'],
  ['技能库', '知识库'],
  ['技能清单', '文件清单'],
  ['SKILLS.md', '各子库 _清单.md'],
  ['改完技能就', '改完内容就'],
  ['技能现在一共', '文件现在一共'],
  ['个技能', '个文件'],
  ['这些技能', '这些文件'],
  ['技能就能用了', '内容就能用了'],
  ['技能有变化', '内容有变化'],
  ['技能和上次一样', '内容和上次一样'],
  ['扫描技能列表', '重新扫描目录'],
  ['把本机已有的技能', '把本机已有的内容'],
  ['技能', '内容'],
];
function tr(text) {
  if (unit().key !== 'kb') return text;
  let out = String(text);
  for (const [from, to] of KB_WORDS) out = out.split(from).join(to);
  return out;
}

// ───────────────────────────────────────────────────────── 输出（纯文本，不用颜色，避免老终端乱码）

const LINE = '='.repeat(60);
const THIN = '-'.repeat(60);

function say(text = '') { console.log(tr(text)); }
function head(title) { say(); say(LINE); say(`  ${title}`); say(LINE); }
function ok(text) { say(`  [OK] ${text}`); }
function warn(text) { say(`  [注意] ${text}`); }
function bad(text) { say(`  [失败] ${text}`); }
function info(text) { say(`  - ${text}`); }

/** 中文算两个字符宽，用来把冒号对齐（纯排版，不影响逻辑） */
function visualWidth(text) {
  return [...String(text)].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
}
function field(label, value, width = 14) {
  return `  ${label}${' '.repeat(Math.max(0, width - visualWidth(label)))}: ${value}`;
}
function pause(text = '按回车继续…') { return ask(text, ''); }

function ask(question, def = '') {
  if (!process.stdin.isTTY || args.yes) {
    if (def !== '') say(`  ${question}${def}`);
    return def;
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = def ? ` [${def}]` : '';
    rl.question(`  ${question}${suffix} `, (answer) => {
      rl.close();
      resolve(answer.trim() === '' ? def : answer.trim());
    });
  });
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** 名单太长时只列前几个，避免刷屏 */
function shortList(items, max = 8) {
  const list = items || [];
  if (list.length <= max) return list.join('、');
  return `${list.slice(0, max).join('、')} 等 ${list.length} 个`;
}

// ───────────────────────────────────────────────────────── 运行外部命令

function run(exe, cmdArgs, opts = {}) {
  const res = spawnSync(exe, cmdArgs, {
    encoding: 'utf8',
    windowsHide: true,
    // 关键：git 提交/拉取上万文件时会逐行打印 create mode ...（轻松超过 1 MB），
    // 默认上限会把子进程掐掉，看起来就像命令失败。给足 256 MB。
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd,
  });
  // 在 DSH 自己的沙箱终端里跑时，子进程拿不到管道（EPERM）。这不是用户会遇到的正常情况，
  // 但把原因写出来比留一行空白强。
  const spawnError = res.error
    ? (res.error.code === 'EPERM'
      ? '（无法调用外部命令：看起来是在 DSH 的终端里运行的，请改成双击 同步助手.cmd 运行）'
      : `（无法调用外部命令：${res.error.message}）`)
    : '';
  return {
    code: res.status === null ? -1 : res.status,
    out: `${res.stdout || ''}${res.stderr || ''}${spawnError}`.trim(),
    stdout: (res.stdout || '').trim(),
  };
}

function findGit() {
  const probe = run(IS_WIN ? 'where' : 'which', ['git']);
  if (probe.code === 0 && probe.stdout) return probe.stdout.split(/\r?\n/)[0].trim();
  const candidates = IS_WIN
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
      ]
    : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

const GIT = findGit();
function git(cmdArgs, opts = {}) {
  if (!GIT) throw new Error('没有找到 git');
  const base = opts.root ? ['-C', opts.root] : [];
  return run(GIT, [...base, ...cmdArgs], opts);
}
function gitOk(cmdArgs, opts = {}) {
  const r = git(cmdArgs, opts);
  if (r.code !== 0) throw new Error(`git ${cmdArgs.slice(0, 2).join(' ')} 失败：${r.out}`);
  return r;
}

// ───────────────────────────────────────────────────────── 设置 + 现状

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    // 老版本是扁平的 { root, remote }（那时候只有技能库），自动搬进 skills 这一栏
    if (raw.root && !raw.skills) {
      raw.skills = {
        root: raw.root, remote: raw.remote || '',
        remoteEmail: raw.remoteEmail || '', lastPush: raw.lastPush || '',
      };
      delete raw.root; delete raw.remote; delete raw.remoteEmail; delete raw.lastPush;
    }
    return raw;
  } catch { return {}; }
}
/** 当前单元自己的设置（技能库和知识库各存各的） */
function unitSettings() { return loadSettings()[unit().key] || {}; }
function saveSettings(patch) {
  const all = loadSettings();
  all[unit().key] = { ...(all[unit().key] || {}), ...patch };
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return all[unit().key];
}

/** 当前单元在系统里的真实目录（技能目录 / 知识库目录） */
function livePath() {
  return unit().live();
}
function syncRoot() {
  return args.root || unitSettings().root || unit().defaultRoot;
}

/** 目录是否是"链接"（Windows 的 junction 在 Node 里也算 symlink，但读法不同） */
function linkTarget(p) {
  if (!fs.existsSync(p) && !isLink(p)) return null;
  if (!isLink(p)) return '';
  try {
    let target = fs.readlinkSync(p);
    if (IS_WIN && target.startsWith('\\\\?\\')) target = target.slice(4);
    return path.resolve(path.dirname(p), target);
  } catch { return ''; }
}
function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function walkStats(dir) {
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        files += 1;
        try { bytes += fs.statSync(p).size; } catch { /* 忽略读不到的文件 */ }
      }
    }
  }
  return { files, bytes };
}

/** 扫描同步文件夹里的 skills：每个含 SKILL.md 的子目录算一个技能 */
function scanSkills(skillsRoot) {
  const list = [];
  const others = [];
  if (!fs.existsSync(skillsRoot)) return { list, others };
  for (const e of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    const p = path.join(skillsRoot, e.name);
    if (!e.isDirectory()) { others.push(e.name); continue; }
    const skillMd = path.join(p, 'SKILL.md');
    if (!fs.existsSync(skillMd)) { others.push(`${e.name}/（没有 SKILL.md，DSH 不会识别）`); continue; }
    let meta = { name: e.name, description: '' };
    try { meta = { ...meta, ...parseFrontmatter(fs.readFileSync(skillMd, 'utf8')) }; } catch { /* 读不到就算了 */ }
    const stats = walkStats(p);
    list.push({ dir: e.name, path: p, files: stats.files, bytes: stats.bytes, ...meta });
  }
  list.sort((a, b) => a.dir.localeCompare(b.dir));
  return { list, others };
}

/** 只解析 SKILL.md 开头 --- --- 之间的 name / description */
function parseFrontmatter(text) {
  const out = { name: '', description: '' };
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return out;
  let key = null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      let value = m[2].trim();
      if (value === '>' || value === '|' || value === '>-' || value === '|-') value = '';
      value = value.replace(/^["']|["']$/g, '');
      if (key === 'name' || key === 'description') out[key] = value;
    } else if (key && /^\s+\S/.test(line) && (key === 'name' || key === 'description')) {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

function gitState() {
  const root = syncRoot();
  const state = {
    root,
    rootExists: fs.existsSync(root),
    isRepo: fs.existsSync(path.join(root, '.git')),
    remote: '',
    branch: 'main',
    lastCommit: '',
    dirty: false,
    aheadBehind: '',
    skillsRoot: path.join(root, unit().sub),
    link: linkTarget(livePath()),
  };
  if (state.isRepo) {
    state.remote = git(['remote', 'get-url', 'origin'], { root }).stdout || '';
    state.branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { root }).stdout || 'main';
    const log = git(['log', '-1', '--format=%h %ad %s', '--date=format:%Y-%m-%d %H:%M'], { root });
    state.lastCommit = log.code === 0 ? log.stdout : '';
    state.dirty = (git(['status', '--porcelain'], { root }).stdout || '').length > 0;
    const counts = git(['rev-list', '--left-right', '--count', `HEAD...@{u}`], { root });
    if (counts.code === 0 && /^\d+\s+\d+$/.test(counts.stdout)) state.aheadBehind = counts.stdout;
  }
  return state;
}

// ───────────────────────────────────────────────────────── 体检 / 菜单

async function actionStatus() {
  const s = gitState();
  // 按"你真正看到的那个目录"统计：没接管时是真实目录，接管后是链接（内容一样）
  const live = livePath();
  const scanDir = fs.existsSync(s.skillsRoot) ? s.skillsRoot : live;
  const skills = scanSkills(scanDir);
  head('现在的情况');
  say(field('本机', `${HOST} (${process.platform})`));
  say(field(unit().dirLabel, live));
  if (s.link === null) say('                  -> 不存在');
  else if (s.link === '') say('                  -> 真实目录（还没被接管）');
  else say(`                  -> 链接到 ${s.link}`);
  if (unit().catalogMode === 'skills') {
    say(field('实际技能', `${skills.list.length} 个，${skills.list.reduce((n, x) => n + x.files, 0)} 个文件，${human(skills.list.reduce((n, x) => n + x.bytes, 0))}`));
  } else {
    const st = walkStats(scanDir);
    const subs = fs.existsSync(scanDir)
      ? fs.readdirSync(scanDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== '_private' && d.name !== '_work').length
      : 0;
    say(field('实际内容', `${st.files} 个文件，${human(st.bytes)}，${subs} 个子库`));
    const pendingBox = inboxPending(scanDir);
    if (pendingBox.length > 0) {
      say(field('收件箱', `${pendingBox.length} 个文件还没归档`));
      say(`  → 对 AI 说一句"归档收件箱"，它会读内容、归类、写好说明`);
    } else {
      say(field('收件箱', '空的（都归档了）'));
    }
  }
  say(field('同步文件夹', `${s.root}${s.rootExists ? '' : '  (还不存在)'}`));
  say(field('Git 仓库', s.isRepo ? '已建立' : '还没有'));
  say(field('同步仓库地址', s.remote || '还没设置'));
  const gitVer = GIT ? run(GIT, ['--version']).stdout : '';
  const gitLine = !GIT ? '未找到，请先安装 git'
    : (gitVer || '找到了但没法执行（例如在 DSH 的沙箱终端里跑）');
  say(`  git           : ${gitLine}`);
  if (s.isRepo) {
    say(`  最近一次提交  : ${s.lastCommit || '（还没有提交）'}`);
    say(`  本机未提交改动: ${s.dirty ? '有（记得【保存并上传】）' : '无'}`);
    if (s.aheadBehind) {
      const [ahead, behind] = s.aheadBehind.split(/\s+/);
      say(`  与远端相比    : 领先 ${ahead} 个提交，落后 ${behind} 个提交`);
    } else if (s.remote) {
      say('  与远端相比    : 还没有建立上游（先做一次【首次上传】）');
    }
  }
  say();
  say(`  下一步建议：${await nextStepText(true)}`);
  if (args.menu !== 'silent') await pause();
}

async function nextStepText(plain = false) {
  const s = {
    root: syncRoot(),
    link: linkTarget(livePath()),
  };
  s.rootExists = fs.existsSync(s.root);
  s.isRepo = fs.existsSync(path.join(s.root, '.git'));
  const remote = s.isRepo ? git(['remote', 'get-url', 'origin'], { root: s.root }).stdout : '';
  if (!s.rootExists || s.link === null || s.link === '') return '第 1 步：把技能搬进同步文件夹（菜单选 1）';
  if (!s.isRepo) return '第 2 步 + 第 3 步：连接 GitHub 并首次上传（菜单选 2，然后选 3）';
  if (!remote) return '第 2 步：填上 GitHub 仓库地址（菜单选 2）';
  const unpushed = git(['rev-list', '--count', '@{u}..HEAD'], { root: s.root });
  if (unpushed.code !== 0) return '第 3 步：首次上传（菜单选 3）';
  if (Number(unpushed.stdout) > 0 || (git(['status', '--porcelain'], { root: s.root }).stdout || '').length > 0) {
    return '日常：保存并上传（菜单选 4）';
  }
  return '一切正常。改完技能就【保存并上传】(4)，换设备先【拉取更新】(5)';
}

// ───────────────────────────────────────────────────────── 第 1 步：搬家 + 接管

async function actionLink() {
  head('第 1 步：把技能搬进同步文件夹并接管');
  const live = livePath();
  const root = syncRoot();
  const target = path.join(root, unit().sub);

  const existing = linkTarget(live);
  if (existing && existing !== '') {
    ok(`技能目录已经是链接，指向 ${existing}，不用再搬。`);
    // 以链接为准：万一设置文件里的同步文件夹记错了（比如换过位置、或上一次没跑完），
    // 这里按"链接指向哪个仓库子目录"反推出真正的同步文件夹，免得后面步骤全走偏。
    const impliedRoot = path.dirname(existing);
    if (impliedRoot && path.resolve(impliedRoot) !== path.resolve(root)) {
      info(`同步文件夹按链接修正为：${impliedRoot}`);
      saveSettings({ root: impliedRoot });
      return;
    }
    saveSettings({ root });
    return;
  }
  if (!fs.existsSync(live)) {
    if (unit().key === 'kb') {
      // 知识库目录还不存在（新设备/刚删过）：直接建好并接管，内容以后往里放
      fs.mkdirSync(target, { recursive: true });
      ensureParentDir(live);
      const linked = makeLink(target, live);
      if (!linked.ok) { bad(`建链接失败：${linked.error}`); info(linked.hint); return; }
      ok(`已建好同步文件夹：${root}`);
      ok(`链接已建立：${live}  ->  ${target}`);
      saveSettings({ root });
      info('接下来做第 2 步：连接 GitHub（菜单选 2）');
      return;
    }
    warn(`技能目录不存在：${live}`);
    info('说明你还没下载过技能。可以先把同步文件夹建好，技能以后再说。');
    fs.mkdirSync(target, { recursive: true });
    ok(`已建好同步文件夹：${root}`);
    saveSettings({ root });
    return;
  }

  const stats = walkStats(live);
  info(`技能目录：${live}`);
  info(`里面有：${stats.files} 个文件，${human(stats.bytes)}`);
  info(`要搬到：${target}`);
  say('  搬完会在原位置建一个"链接"指过去，DSH 看不出区别。');
  const go = await ask('开始搬家？(y/n)', 'y');
  if (go.toLowerCase() !== 'y') { info('已取消。'); return; }

  ensureParentDir(target);
  if (fs.existsSync(target)) {
    const destStats = walkStats(target);
    if (destStats.files > 0) {
      bad(`目标已存在且有文件：${target}`);
      info('说明同步文件夹里已经有一份技能了（可能是别的设备推上来的）。');
      info(`现在这里的技能目录：${live}（${stats.files} 个文件）`);
      info('请先手动决定留哪一份，或把其中一份改名备份后再运行。我不会替你删任何东西。');
      return;
    }
  }

  say('  正在搬家，文件多的话要等一会儿…');
  const moved = await moveDir(live, target);
  if (!moved.ok) {
    bad(`搬家失败：${moved.error}`);
    info('技能目录没有被改动，可以放心重试。');
    return;
  }
  const after = walkStats(target);
  if (after.files !== stats.files) {
    bad(`搬过去的文件数不对（原 ${stats.files}，现在 ${after.files}）。`);
    info('已停下，没有删除原目录。请检查后重试。');
    return;
  }
  ok(`搬家完成：${after.files} 个文件，${human(after.bytes)}`);

  ensureParentDir(live);
  const linked = makeLink(target, live);
  if (!linked.ok) {
    bad(`建链接失败：${linked.error}`);
    info(`技能还在：${target}`);
    info(`请手动执行：${linked.hint}`);
    return;
  }
  // 通过链接读一遍，确认真能用
  const through = walkStats(live);
  if (through.files !== stats.files) {
    bad('链接建好了，但通过它读到的文件数不对，请检查。');
    return;
  }
  ok(`链接已建立：${live}  ->  ${target}`);
  ok('现在 DSH 看到的技能和以前完全一样。');
  saveSettings({ root });
  say();
  ok(`同步文件夹记下了：${root}`);
  info('接下来做第 2 步：连接 GitHub（菜单选 2）');
}

/** 需要时创建上级目录。
 *  坑：D:\KB 的上级是盘符根目录 D:\ 本身，绝不能去 mkdir 它（会 EPERM 失败）。
 *  知识库默认就在 D:\KB，所以这行必须判断"父目录已存在就跳过"。 */
function ensureParentDir(p) {
  const parent = path.dirname(p);
  if (parent && parent !== p && parent !== path.parse(p).root && !fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function moveDir(from, to) {
  if (IS_WIN) {
    // 直接调 robocopy.exe（不要经过 cmd，否则 Node 会把参数里的引号再转义一次）
    try {
      const r = run('robocopy', [from, to, '/E', '/MOVE', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']);
      if (r.code < 8) return { ok: true };
      return { ok: false, error: `robocopy 退出码 ${r.code}` };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  try {
    execFileSync('cp', ['-R', `${from}/.`, to]);
    fs.rmSync(from, { recursive: true, force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function makeLink(target, link) {
  if (IS_WIN) {
    // 参数分开传，让 Node 自己加引号（拼成一整串再塞给 cmd 会被转义坏掉）
    const r = run('cmd', ['/c', 'mklink', '/J', link, target]);
    if (r.code === 0) return { ok: true };
    return { ok: false, error: r.out, hint: `cmd /c mklink /J "${link}" "${target}"` };
  }
  try {
    fs.symlinkSync(target, link, 'dir');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message, hint: `ln -s "${target}" "${link}"` };
  }
}

// ───────────────────────────────────────────────────────── 第 2 步：连接 GitHub

async function actionRemote(urlArg) {
  head('第 2 步：连接 GitHub 仓库');
  const root = syncRoot();
  if (!fs.existsSync(root)) {
    bad(`同步文件夹还不存在：${root}`);
    info('请先做第 1 步（菜单选 1）。');
    return;
  }
  if (!gitState().isRepo) {
    say('  这个文件夹还不是 Git 仓库，现在建一个。');
    gitOk(['init'], { root });
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], { root });
    git(['config', 'core.autocrlf', 'false'], { root });
    git(['config', 'core.safecrlf', 'false'], { root });
    writeRepoFiles(root);
    ok('已建立 Git 仓库并写好配置文件');
  }

  let url = urlArg || unitSettings().remote || '';
  if (!url) {
    say();
    say('  请先在浏览器里做 3 件事：');
    say('    1) 打开  https://github.com/new');
    say('    2) Repository name 填：dsh-skills');
    say('    3) 选 Public（这些是文档和模板，不含密钥），点 Create repository');
    say('  建好后页面中间有个地址，长这样：');
    say('    https://github.com/你的用户名/dsh-skills.git');
    say();
    const open = await ask('要我帮你打开 https://github.com/new 吗？(y/n)', 'y');
    if (open.toLowerCase() === 'y') {
      try {
        if (IS_WIN) run('cmd', ['/c', 'start', '', 'https://github.com/new']);
        else run('open', ['https://github.com/new']);
      } catch { /* 打不开就让用户自己开 */ }
    }
    say();
    url = await ask('把那个地址粘贴到这里（直接回车 = 稍后再弄）', '');
    if (!url) { info('已跳过。想连的时候再选菜单 2。'); return; }
  }

  const looksLikeUrl = /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(url);
  const looksLikePath = /^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('\\\\');
  if (!looksLikeUrl && !looksLikePath) {
    bad(`这个地址看着不像仓库地址：${url}`);
    info('GitHub 的地址应该以 https:// 开头、以 .git 结尾，例如：');
    info('  https://github.com/你的用户名/dsh-skills.git');
    return;
  }
  if (!looksLikeUrl) {
    warn('你填的是本机/局域网路径（不是 GitHub 地址）。');
    info('自己测试完全没问题；想真正云同步就换成 GitHub 地址。');
  }

  say();
  info(`正在测试能不能访问：${url}`);
  const probe = run(GIT, ['ls-remote', url], { env: { GIT_TERMINAL_PROMPT: '0' } });
  if (probe.code === 0) {
    const refs = probe.stdout ? probe.stdout.split(/\r?\n/).filter(Boolean).length : 0;
    ok(refs === 0 ? '仓库可以访问，现在是空的（正合适）' : `仓库可以访问，里面已有 ${refs} 个引用（有内容）`);
  } else if (/could not read Username|terminal prompts disabled|Authentication failed|403/i.test(probe.out)) {
    warn('这个地址需要登录（可能是 private 仓库，或者名字写错了）。');
    info('要么把它设成 Public，要么先不管——上传时 Git 会弹窗让你登录。');
  } else if (/not found|does not exist|Repository not found|404/i.test(probe.out)) {
    bad('GitHub 说这个仓库不存在。多半是地址里的用户名/仓库名写错了。');
    info(probe.out.split(/\r?\n/)[0]);
    return;
  } else {
    warn('没能确认（可能是网络问题）：');
    info(probe.out.split(/\r?\n/).slice(0, 3).join(' / '));
  }

  const current = git(['remote', 'get-url', 'origin'], { root }).stdout;
  if (current) gitOk(['remote', 'set-url', 'origin', url], { root });
  else gitOk(['remote', 'add', 'origin', url], { root });
  saveSettings({ root, remote: url });
  ok(`已记住仓库地址：${url}`);
  saveSettings({ remoteEmail: suggestEmail(url) });
  say();
  info('接下来做第 3 步：首次上传（菜单选 3）');
}

function suggestEmail(url) {
  const m = /github\.com[:/]([^/]+)\//.exec(url || '');
  return m ? `${m[1]}@users.noreply.github.com` : '';
}

// ───────────────────────────────────────────── 多端并集：合并远端 + 自动重建清单

/** 本机现在有哪些技能（只看目录名，用来告诉用户"这次多了哪几个"） */
function skillNames(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsRoot, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

function listDiff(before, after) {
  return {
    added: after.filter((x) => !before.includes(x)),
    removed: before.filter((x) => !after.includes(x)),
  };
}

/** push 被挡住的真正原因：远端比本机新 */
function remoteAhead(root) {
  const f = git(['fetch', '--quiet'], { root });
  if (f.code !== 0) return false;
  const u = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { root });
  if (u.code !== 0) return false;
  return Number(git(['rev-list', '--count', 'HEAD..@{u}'], { root }).stdout) > 0;
}

/** 把远端合回来。
 *  清单文件是"生成物"，两边各生成一份必然会撞车，所以这里直接重做一份；
 *  真技能文件两边都改了才交给人处理。 */
async function mergeRemote(root) {
  // --allow-unrelated-histories：万一 GitHub 上建仓库时勾了 "Add a README"，
  // 两边历史没有共同祖先，默认会拒绝合并；加上这个参数就能正常合。
  const pull = git(['pull', '--no-rebase', '--no-edit', '--autostash', '--allow-unrelated-histories'], { root });
  if (pull.code === 0) return { ok: true, output: pull.stdout };
  const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { root }).stdout
    .split(/\r?\n/).filter(Boolean);
  // 清单是生成物，任何人手改都没意义 —— 只要它冲突了就直接重做一份
  if (conflicts.includes(unit().catalogName)) {
    await refreshCatalog(true);
    git(['add', unit().catalogName], { root });
  }
  const real = conflicts.filter((f) => f !== unit().catalogName);
  if (real.length > 0) return { ok: false, conflicts: real, output: pull.out };
  const done = git(['commit', '--no-edit'], { root });
  if (done.code !== 0) return { ok: false, conflicts: real, output: done.out };
  return { ok: true, output: pull.stdout };
}

function printConflictRecipe(root, conflicts) {
  warn('两边都改过同一个技能，这部分得你挑一下：');
  conflicts.forEach((f) => say(`     ${f}`));
  say();
  info('（技能清单 SKILLS.md 也冲突了的话，工具已经自动重建好，不用管它。）');
  info('处理办法：');
  info('  1) 打开上面这些文件，把 <<<<<<< ======= >>>>>>> 之间改成你要的样子');
  info(`  2) 然后：cd "${root}" ; git add -A ; git commit --no-edit ; git push`);
  info('  3) 想放弃这次合并：git merge --abort');
  info('（把冲突那几段发给我，我可以帮你合成一份。）');
}

/** 当前单元"有哪些组成部分"：技能库 = 技能名；知识库 = 子库名 */
function unitList(dir) {
  if (unit().catalogMode === 'skills') return skillNames(dir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== '_private' && d.name !== '_work')
    .map((d) => d.name).sort();
}

/** 同一句话的两种说法：技能库报"几个技能 + 名单"，知识库报"几个文件 + 体积" */
function unitSummary(dir) {
  if (unit().catalogMode === 'skills') {
    const names = skillNames(dir);
    return `本机现在一共 ${names.length} 个技能：${names.join('、')}`;
  }
  const st = walkStats(dir);
  return `本机现在一共 ${st.files} 个文件，${human(st.bytes)}`;
}

/** 知识库收件箱里还没归档的文件（_说明.md / _清单.md 不算）。返回相对路径列表。 */
function inboxPending(dir) {
  const box = path.join(dir, '_inbox');
  const out = [];
  if (!fs.existsSync(box)) return out;
  const stack = [box];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name !== '_说明.md' && e.name !== '_清单.md') out.push(path.relative(dir, p));
    }
  }
  return out.sort();
}

/** 刷新清单：技能库 = 重建 SKILLS.md；知识库 = 刷新各子库的 _清单.md */
async function refreshCatalog(silent = true) {
  if (unit().catalogMode === 'skills') return actionCatalog(silent);
  return actionInventory(silent);
}

/** 知识库专用：把 from 里"目标没有的文件"复制进 to（并集），返回结果清单。
 *  两边都有同名文件的**不动**，留给调用方备份，绝不覆盖。 */
function mergeTreeInto(from, to) {
  const added = [];
  const both = [];
  const walk = (srcDir, rel) => {
    for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const src = path.join(srcDir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const dst = path.join(to, r);
      if (e.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        walk(src, r);
      } else if (fs.existsSync(dst)) {
        both.push(r);
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        added.push(r);
        try { fs.rmSync(src); } catch { /* 删不掉就留着，备份里还会有 */ }
      }
    }
  };
  walk(from, '');
  return { added, both };
}

/** 写 .gitattributes / .gitignore（跨平台关键：禁止换行符转换）
 *  这两个文件刻意只用英文注释：它们是给 Git 看的配置文件，用英文能避免
 *  各种 Windows 工具按 GBK 误读出现乱码。 */
/** 写 .gitattributes / .gitignore（跨平台关键：禁止换行符转换）
 *  这两个文件刻意只用英文注释：它们是给 Git 看的配置文件，用英文能避免
 *  各种 Windows 工具按 GBK 误读出现乱码。 */
function attrsRules() {
  const rules = [
    '# Keep bytes identical on every OS: never convert line endings.',
    '# (plain text, scripts and Office templates must agree byte for byte)',
    '* -text',
  ];
  if (unit().catalogMode === 'skills') {
    rules.push('# SKILLS.md is generated output: never let Git text-merge two versions,');
    rules.push('# the tool always rebuilds it from the merged skill set instead.');
    rules.push(`${unit().catalogName} -merge`);
  }
  return [...rules, ''];
}

function ignoreRules() {
  const rules = [
    '# OS junk files',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '*.tmp',
    '',
    '# never publish real credentials: some skills keep keys in a local .env',
    '.env',
    '.env.*',
    '!.env.example',
    '*.pem',
    '*.key',
    '',
  ];
  if (unit().key === 'kb') {
    rules.push('# local-only areas: never uploaded — safe place for private files or scratch work');
    rules.push('_private/');
    rules.push('_work/');
    rules.push('');
  }
  rules.push('# per-machine settings of the sync tool (never share)');
  rules.push(`${TOOL_SUBDIR}/settings.json`);
  rules.push('');
  return rules;
}

/** 把缺失的规则补进已有文件（已有则不动，注释行不参与比对） */
function upsertRules(file, rules) {
  const want = rules.join('\n');
  if (!fs.existsSync(file)) { fs.writeFileSync(file, want, 'utf8'); return; }
  const have = fs.readFileSync(file, 'utf8');
  const missing = rules.filter((line) => line.trim() && !line.startsWith('#') && !have.includes(line));
  if (missing.length > 0) fs.writeFileSync(file, `${have.replace(/\s*$/, '')}\n${missing.join('\n')}\n`, 'utf8');
}

function writeRepoFiles(root) {
  upsertRules(path.join(root, '.gitattributes'), attrsRules());
  upsertRules(path.join(root, '.gitignore'), ignoreRules());
  // 让 git 输出里的中文路径保持可读（默认会被转义成 \346\250\241 这种八进制，
  // 那样脚本就没法按路径找到真实文件 —— 上传前检查就失效了）
  if (fs.existsSync(path.join(root, '.git'))) git(['config', 'core.quotepath', 'false'], { root });
}

// ───────────────────────────────────────────────────────── 第 3 步：首次上传 / 日常保存

// 上传前的安全检查：仓库可能是公开的，先把明显不该公开的东西拦下来
const SECRET_NAME = /^(\.env.*|\.?id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|pfx|p12|keystore|ovpn))$/i;
const SENSITIVE_WORD = /(涉密|机密|绝密|内部资料|身份证|工资|薪资|银行|账号密码)/;

async function pushGuard(root) {
  // 必须加 --untracked-files=all：默认会把整个未跟踪目录折叠成一行，
  // 那样就看不到目录里面的文件，拦截器等于失效。
  // core.quotepath=false：否则中文路径会被转义，拼不回真实路径。
  const status = git(['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'], { root }).stdout;
  const changed = status.split(/\r?\n/).filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((p) => (p.includes(' -> ') ? p.split(' -> ').pop() : p))
    .map((p) => p.replace(/^"|"$/g, ''));
  const secrets = [];
  const words = [];
  const big = [];
  for (const rel of changed) {
    const full = path.join(root, rel);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const base = path.basename(rel);
    if (SECRET_NAME.test(base)) secrets.push(rel);
    else if (SENSITIVE_WORD.test(base)) words.push(rel);
    if (st.size > 20 * 1024 * 1024) big.push({ rel, size: st.size });
  }

  if (secrets.length > 0 && !args['allow-risky']) {
    bad('这些文件看着像密钥，先拦下来了（万一仓库是公开的，传上去就等于泄密）：');
    secrets.forEach((f) => say(`     ${f}`));
    info('确认没问题再加参数 --allow-risky 强制上传；否则请先移到 _private/ 或删掉。');
    return false;
  }
  if (big.length === 0 && words.length === 0) return true;

  if (big.length > 0) {
    warn('这些文件偏大，上传会慢，而且 Git 历史里会一直留着：');
    big.forEach((f) => say(`     ${f.rel}   ${human(f.size)}`));
    info('GitHub 限制：单个文件超过 100 MB 直接拒收，超过 50 MB 会警告，仓库越大 clone 越慢。');
  }
  if (words.length > 0) {
    warn('这些文件名里有敏感词，传上去别人就能看到：');
    words.forEach((f) => say(`     ${f}`));
  }
  if (args['allow-big'] || args['allow-risky']) return true;
  const ans = String(await ask('确定要上传这些吗？(y/n)', 'n')).toLowerCase();
  if (ans !== 'y' && ans !== 'yes') {
    info('已取消上传 —— 东西都还在你本机，没有被删。');
    return false;
  }
  return true;
}

async function actionPush(firstTime = false) {
  head(firstTime ? `第 3 步：首次上传到 GitHub` : '保存并上传');
  const root = syncRoot();
  if (!fs.existsSync(root)) { bad(`同步文件夹不存在：${root}`); info('先做第 1 步（菜单选 1）。'); return; }
  if (!gitState().isRepo) { bad('这还不是 Git 仓库。'); info('先做第 2 步（菜单选 2）。'); return; }

  ensureIdentity();
  writeRepoFiles(root);
  copyToolIntoRepo(root);
  await refreshCatalog(true);

  if (unit().key === 'kb') {
    const box = inboxPending(path.join(root, unit().sub));
    if (box.length > 0) {
      warn(`收件箱里还有 ${box.length} 个文件没归档：${shortList(box, 3)}`);
      info('先对 AI 说一句"归档收件箱"（它读内容、归类、写好用途说明），再回来按 4。');
      info('继续上传也行，但没有说明的文件 AI 以后找不到它们。');
    }
  }

  const stats = walkStats(path.join(root, unit().sub));
  info(`${unit().dirLabel}：${stats.files} 个文件，${human(stats.bytes)}`);
  if (firstTime && unit().key === 'kb') {
    info('提醒：这个仓库是公开的，放进去的东西任何人都能看、也可能被搜索引擎收录。');
    info('不方便公开的放 _private/ 子目录（已在 .gitignore 里，永远不会上传）。');
  }
  if (!(await pushGuard(root))) return;

  gitOk(['add', '-A'], { root: root });
  const staged = git(['diff', '--cached', '--name-only'], { root: root }).stdout;
  if (staged) {
    const count = staged.split(/\r?\n/).filter(Boolean).length;
    const msg = `${IS_WIN ? 'Windows' : 'macOS'} ${HOST}: ${firstTime ? '首次上传' : '更新'}${unit().label}（${count} 个文件）`;
    const commit = git(['commit', '-m', msg], { root });
    if (commit.code !== 0) {
      // 兜底：Git 返回码有时会被奇怪地污染（比如输出量太大），先确认提交到底建没建立
      const head = git(['rev-parse', '--short', 'HEAD'], { root }).stdout;
      const headMsg = git(['log', '-1', '--format=%s'], { root }).stdout;
      if (head && headMsg === msg) {
        ok(`已提交 ${count} 个改动（Git 返回码 ${commit.code}，但提交确实建好了：${head}）`);
      } else {
        bad('提交失败：');
        say(`     ${commit.out.split(/\r?\n/).slice(0, 4).join('\n     ')}`);
        return;
      }
    } else {
      ok(`已提交 ${count} 个改动（${unit().label} + 清单 + 工具）`);
    }
  } else {
    ok(`没有新改动（${unit().label}和上次一样）`);
  }
  git(['branch', '-M', 'main'], { root });

  const remote = git(['remote', 'get-url', 'origin'], { root }).stdout;
  if (!remote) {
    warn('还没设置 GitHub 仓库地址，改动只保存在本机。');
    info('想连 GitHub 就去做第 2 步（菜单选 2）。');
    return;
  }

  say(firstTime
    ? '  正在上传到 GitHub…（技能文件多的话第一次要几分钟）'
    : '  正在上传到 GitHub…');
  let push = git(['push', '-u', 'origin', 'main'], { root });

  // 上传被挡住，十有八九是另一台设备先推了 —— 先合并回来再推一次，
  // 这样"两边各自加技能"最后就是并集，不用你自己去 pull。
  if (push.code !== 0 && remoteAhead(root)) {
    const before = skillNames(path.join(root, unit().sub));
    say('  另一台设备已经推过东西了，先合并回来再上传…');
    const merged = await mergeRemote(root);
    if (!merged.ok) {
      bad('合并没成功。');
      if (merged.conflicts?.length) printConflictRecipe(root, merged.conflicts);
      else say(`     ${String(merged.output || '').split(/\r?\n/).slice(0, 6).join('\n     ')}`);
      return;
    }
    const after = skillNames(path.join(root, unit().sub));
    const d = listDiff(before, after);
    if (d.added.length) ok(`合并进来这些技能：${d.added.join('、')}`);
    if (d.removed.length) info(`另一台删掉了这些技能：${d.removed.join('、')}`);
    // 合并后的清单按并集重建，保证和真实技能一致
    await refreshCatalog(true);
    git(['add', '-A'], { root });
    if ((git(['diff', '--cached', '--name-only'], { root }).stdout || '').length > 0) {
      git(['commit', '-m', `${IS_WIN ? 'Windows' : 'macOS'} ${HOST}: 合并另一台设备后重建${unit().label}清单`], { root });
    }
    push = git(['push', '-u', 'origin', 'main'], { root });
  }

  if (push.code !== 0) {
    bad('上传失败：');
    say(`     ${push.out.split(/\r?\n/).slice(0, 6).join('\n     ')}`);
    say();
    info('常见原因：');
    info('  1) 需要登录 —— 再运行一次本菜单，Git 会弹出登录窗口');
    info('  2) 仓库地址不对 —— 菜单 2 重新填一次');
    info('  3) 网络问题（国内直连 GitHub 有时不稳）');
    info('  4) 两边真冲突 —— 用菜单 5【拉取更新】看它给出的处理办法');
    return;
  }

  const localSha = git(['rev-parse', 'HEAD'], { root }).stdout;
  const remoteSha = run(GIT, ['ls-remote', remote, 'refs/heads/main']).stdout.split(/\s+/)[0] || '';
  say();
  if (localSha && localSha === remoteSha) {
    ok(`上传成功，并且核对一致：${localSha.slice(0, 8)}`);
    saveSettings({ root, remote, lastPush: new Date().toISOString() });
    ok(unitSummary(path.join(root, unit().sub)));
    info('另一台设备点【拉取更新】就会变成同一套（并集）。');
    say();
    say('  以后就两件事：');
    say(`    - 改完${unit().label} -> 菜单 4【保存并上传】`);
    say('    - 换设备开用 -> 菜单 5【拉取更新】');
  } else {
    warn('上传命令执行完了，但没核对一致，请再点一次菜单 6 体检看看。');
  }
}

function ensureIdentity() {
  const name = git(['config', '--global', '--get', 'user.name']).stdout;
  const email = git(['config', '--global', '--get', 'user.email']).stdout;
  if (name && email) return;
  const fallbackEmail = suggestEmail(unitSettings().remote) || `${USER}@${HOST}`;
  if (!name) git(['config', '--global', 'user.name', USER]);
  if (!email) git(['config', '--global', 'user.email', fallbackEmail]);
  ok(`Git 提交身份原本没设置，已自动填好：${name || USER} <${email || fallbackEmail}>`);
  info('想改成自己的邮箱：git config --global user.email "you@example.com"');
}

function copyToolIntoRepo(root) {
  if (!unit().shipsTool) return;   // 知识库仓库不带工具（工具跟着技能库走，只留一份）
  const dest = path.join(root, TOOL_SUBDIR);
  fs.mkdirSync(dest, { recursive: true });
  const files = fs.readdirSync(TOOL_DIR).filter((f) => f === 'skills-sync.mjs' || f.endsWith('.cmd') || f.endsWith('.command'));
  for (const f of files) {
    const src = path.join(TOOL_DIR, f);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(dest, f));
    if (!IS_WIN && f.endsWith('.command')) fs.chmodSync(path.join(dest, f), 0o755);
  }
}

// ───────────────────────────────────────────────────────── 日常：拉取更新

async function actionPull() {
  head('拉取更新（把另一台设备的改动取回本机）');
  const root = syncRoot();
  const s = gitState();
  const skillsRoot = path.join(root, unit().sub);
  if (!s.isRepo || !s.remote) { bad('本机还没连上 GitHub 仓库。'); info('先做第 2 步（菜单选 2），或者用第 8 项克隆技能库。'); return; }

  const fetch = git(['fetch', '--prune'], { root });
  if (fetch.code !== 0) { bad(`连不上远端：${fetch.out.split(/\r?\n/)[0]}`); return; }
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { root });
  const counts = upstream.code === 0 ? git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { root }).stdout : '';
  if (/^\d+\s+\d+$/.test(counts)) {
    const [ahead, behind] = counts.split(/\s+/);
    info(`本机领先 ${ahead} 个提交，落后 ${behind} 个提交`);
    if (behind === '0') {
      ok('已经是最新的，不用拉。');
      ok(unitSummary(skillsRoot));
      return;
    }
  }
  const before = unitList(skillsRoot);
  // 还没建立上游时（比如刚 clone 完别人推的分支），直接用显式分支名拉
  const pullArgs = upstream.code === 0
    ? ['pull', '--no-rebase', '--no-edit', '--autostash', '--allow-unrelated-histories']
    : ['pull', '--no-rebase', '--no-edit', '--autostash', '--allow-unrelated-histories', 'origin', s.branch || 'main'];
  const pull = git(pullArgs, { root });
  if (pull.code !== 0) {
    const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { root }).stdout.split(/\r?\n/).filter(Boolean);
    if (conflicts.length > 0) {
      bad('两边都改了同一批文件，需要你挑一下：');
      printConflictRecipe(root, conflicts);
    } else {
      bad('拉取失败：');
      say(`     ${pull.out.split(/\r?\n/).slice(0, 8).join('\n     ')}`);
    }
    return;
  }
  ok('已拉取到最新');
  say(`     ${pull.stdout.split(/\r?\n/).slice(0, 10).join('\n     ')}`);

  const after = unitList(skillsRoot);
  const d = listDiff(before, after);
  if (d.added.length) ok(`这次多出这些技能：${d.added.join('、')}`);
  if (d.removed.length) info(`这次少了这些技能：${d.removed.join('、')}（另一台删掉过）`);

  // 按合并后的内容重建清单；有变化就顺手提交，让 GitHub 上也保持一致
  await refreshCatalog(true);
  if (unit().catalogMode === 'skills') git(['add', unit().catalogName], { root });
  else git(['add', '-A'], { root });
  if ((git(['diff', '--cached', '--name-only'], { root }).stdout || '').length > 0) {
    git(['commit', '-m', `${IS_WIN ? 'Windows' : 'macOS'} ${HOST}: 按合并后的${unit().label}重建清单`], { root });
    const pushed = git(['push'], { root });
    if (pushed.code === 0) ok('清单已按并集重建，并同步回 GitHub');
    else info('清单已按并集重建（下次【保存并上传】会一起提交）');
  }

  ok(unitSummary(skillsRoot));
  say();
  info('提示：技能有变化的话，重开一次 DSH 让它重新扫描技能列表。');
}

// ───────────────────────────────────────────────────────── 换新设备：克隆

async function actionClone(urlArg, rootArg) {
  head('换新设备：把技能库克隆到本机并接管');
  const url = urlArg || (await ask('技能库的 GitHub 地址（https://…/dsh-skills.git）', unitSettings().remote || ''));
  if (!url) { info('已取消。'); return; }
  const root = rootArg || (await ask('放在哪个文件夹', syncRoot()));
  if (fs.existsSync(path.join(root, '.git'))) {
    ok(`这个文件夹已经是仓库了：${root}`);
  } else if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    bad(`目标文件夹不是空的：${root}`);
    return;
  } else {
    say(`  正在克隆（第一次要下载几万个文件，可能要几分钟）…`);
    const clone = run(GIT, ['clone', url, root]);
    if (clone.code !== 0) {
      bad('克隆失败：');
      say(`     ${clone.out.split(/\r?\n/).slice(0, 6).join('\n     ')}`);
      return;
    }
    ok(`已下载到：${root}`);
  }
  saveSettings({ root, remote: url });

  const target = path.join(root, unit().sub);
  const live = livePath();
  const existing = linkTarget(live);
  let mergedIn = [];
  let bothSides = [];
  let backup = '';
  if (existing && existing !== '') {
    ok(`技能目录已经是链接（${existing}），不用再建。`);
  } else if (fs.existsSync(live)) {
    // 关键：本机原有的东西不是"扔掉不要"，而是**并**进来。
    // 两边同名但内容可能不同的，保留远端那份，本机那份备份走，由你来决定。
    if (unit().catalogMode === 'skills') {
      const localNames = skillNames(live);
      const remoteNames = skillNames(target);
      mergedIn = localNames.filter((n) => !remoteNames.includes(n));
      bothSides = localNames.filter((n) => remoteNames.includes(n));
      for (const name of mergedIn) {
        const moved = moveDir(path.join(live, name), path.join(target, name));
        if (!moved.ok) warn(`技能 ${name} 并进来时失败：${moved.error}`);
        else ok(`把本机已有的技能并进技能库：${name}`);
      }
    } else {
      // 知识库：按文件逐个并 —— 目标里没有的复制过来，同名的不覆盖（留给备份）
      const merged = mergeTreeInto(live, target);
      mergedIn = merged.added;
      bothSides = merged.both;
      if (mergedIn.length > 0) {
        ok(`把本机已有的 ${mergedIn.length} 个文件并进知识库`);
        for (const f of mergedIn.slice(0, 10)) say(`     ${f}`);
        if (mergedIn.length > 10) say(`     …另外 ${mergedIn.length - 10} 个`);
      }
    }
    const rest = walkStats(live);
    if (rest.files > 0 || bothSides.length > 0) {
      backup = `${live}.old-${Date.now().toString().slice(-6)}`;
      fs.renameSync(live, backup);
      info(`本机原有的技能目录已改名备份：${backup}`);
      if (bothSides.length > 0) {
        warn(`这些技能两边都有，先用了远端的版本，本机那份在备份里：${shortList(bothSides)}`);
      }
      info('确认没问题后可以删掉这个备份目录。');
    } else {
      fs.rmSync(live, { recursive: true, force: true });
    }
    const linked = makeLink(target, live);
    if (!linked.ok) { bad(`建链接失败：${linked.error}`); info(linked.hint); return; }
    ok(`链接已建立：${live}  ->  ${target}`);
  } else {
    ensureParentDir(live);
    const linked = makeLink(target, live);
    if (!linked.ok) { bad(`建链接失败：${linked.error}`); info(linked.hint); return; }
    ok(`链接已建立：${live}  ->  ${target}`);
  }

  // macOS：让双击启动器可执行（技能库/知识库都检查一遍）
  if (!IS_WIN) {
    const toolDir = path.join(root, TOOL_SUBDIR);
    if (fs.existsSync(toolDir)) {
      for (const f of fs.readdirSync(toolDir)) {
        if (!f.endsWith('.command')) continue;
        try { fs.chmodSync(path.join(toolDir, f), 0o755); } catch { /* 忽略 */ }
      }
    }
  }

  await refreshCatalog(true);
  if (mergedIn.length > 0) {
    // 把并进来的东西提交并推上去，另一台这才看得到
    writeRepoFiles(root);
    copyToolIntoRepo(root);
    git(['add', '-A'], { root });
    const commit = git(['commit', '-m', `${IS_WIN ? 'Windows' : 'macOS'} ${HOST}: 合并本机已有的${unit().label}（${shortList(mergedIn)}）`], { root });
    if (commit.code === 0) {
      const pushed = git(['push'], { root });
      if (pushed.code === 0) ok('已经上传，另一台拉取后就是并集');
      else info('暂时没能上传（联网/登录问题），下次【保存并上传】会一起提交');
    }
  }
  say();
  ok(unitSummary(target));
  if (backup) info(`本机原有的备份目录：${backup}`);
  if (unit().catalogMode === 'skills') info('重开一次 DSH，技能就能用了。');
  else info(`${unit().label}已经在 ${live}，直接打开就能用。`);
  info(`以后改完${unit().label}：【保存并上传】（菜单 4）；换回另一台前先在那台【拉取更新】。`);
}

// ───────────────────────────────────────────────────────── 技能清单 SKILLS.md

const KNOWN_TIPS = {
  'doc-format': {
    一句话: '把 doc/docx/wps/txt/md 文件按公文格式排好，输出标准 docx（标题层级、字体字号、行距、页边距、页码都能自动套）。',
    怎么说: '「把这份文件按公文格式排版」「这份通知排一下版」「把这个 txt 转成规范公文 docx」',
  },
  'official-document-skill': {
    一句话: '起草、修改、润色党政机关公文和政务文稿，顺便把"AI 味"洗掉。',
    怎么说: '「帮我写一份关于开展××工作的通知」「这段总结太像 AI 写的，改得像人写的」「把这份报告润色一版」',
  },
  'ppt-master': {
    一句话: '从零生成可编辑的 PPTX；也能按模板填充、拆分重建已有 PPT、给成品做美化。',
    怎么说: '「做一份 20 页的××汇报 PPT」「照这个模板把内容填进 PPT」「把这份 PPT 美化一下并加讲解词」',
  },
  'huashu-design': {
    一句话: '用 HTML 做高保真原型、网页版幻灯片、动画和数据可视化；开工前会先给 3 个方向让你挑。',
    怎么说: '「做一个××产品的 HTML 原型」「用网页做一版产品介绍片」「给我的数据做个可视化的页面」',
  },
};

async function actionCatalog(silent = false) {
  // 知识库走另一套：INDEX.md 由你自己维护，工具只刷新各子库的 _清单.md
  if (unit().catalogMode === 'inventory') return actionInventory(silent);
  const root = syncRoot();
  const skillsRoot = path.join(root, unit().sub);
  const live = livePath();
  // 还没搬家时，就直接扫描你当前的技能目录 —— 这样"菜单 7"在第 1 步之前也能用
  const scanRoot = fs.existsSync(skillsRoot) ? skillsRoot : live;
  if (!fs.existsSync(scanRoot)) {
    if (!silent) { bad(`还没找到技能目录：${scanRoot}`); info('先做第 1 步（菜单选 1）。'); }
    return;
  }
  const inRepo = scanRoot === skillsRoot;
  const { list, others } = scanSkills(scanRoot);
  const totalFiles = list.reduce((n, x) => n + x.files, 0);
  const totalBytes = list.reduce((n, x) => n + x.bytes, 0);

  // 刻意不放时间戳/机器名：这样两台设备对同一套技能生成的清单是逐字节相同的，
  // Git 合并时永远不会因为"谁生成的"而冲突。
  const lines = [];
  lines.push('# 我的 DSH 技能清单');
  lines.push('');
  lines.push('> 这份文件由「DSH 技能同步助手」自动生成，手改没用：每次【保存并上传】或【拉取更新】都会按当时的技能重新生成。');
  if (!inRepo) lines.push(`> （预览版：现在读取的是本机技能目录 \`${scanRoot}\`）`);
  lines.push('');
  lines.push(`一共 **${list.length} 个技能**，${totalFiles} 个文件，约 ${human(totalBytes)}。`);
  lines.push('');
  lines.push('## 怎么用这些技能');
  lines.push('');
  lines.push('不用记命令，也不用背名字 —— **直接说要做什么**，DSH 会自己挑合适的技能；');
  const example = list.find((s) => KNOWN_TIPS[s.dir])?.dir || list[0]?.dir || '某个技能';
  lines.push(`想指定某个技能时，直接在话里点名，例如「用 ${example} 帮我……」。`);
  lines.push('');
  lines.push('多台设备的规则：**各设备自己新增的技能会拼在一起（并集）**，上面这份清单就是并集；');
  lines.push('只有在两台设备上"改了同一个技能的同一些文件"时，才需要手工挑一下。');
  lines.push('');
  lines.push('| 技能 | 干什么 | 文件数 | 大小 |');
  lines.push('|---|---|---|---|');
  for (const s of list) {
    const tip = KNOWN_TIPS[s.dir];
    const one = (tip ? tip.一句话 : s.description || '（SKILL.md 里没写简介）').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    lines.push(`| \`${s.dir}\` | ${one} | ${s.files} | ${human(s.bytes)} |`);
  }
  lines.push('');

  for (const s of list) {
    const tip = KNOWN_TIPS[s.dir];
    lines.push(`## ${s.dir}`);
    lines.push('');
    lines.push(`- **干什么**：${tip ? tip.一句话 : s.description || '（SKILL.md 里没写简介）'}`);
    if (tip?.怎么说) lines.push(`- **你可以这么说**：${tip.怎么说}`);
    if (!tip && s.description) lines.push('- **你可以这么说**：直接描述你要做的事，或者点名这个技能');
    lines.push(`- **放哪儿**：\`${inRepo ? `skills/${s.dir}` : path.join(scanRoot, s.dir)}\`（${s.files} 个文件，${human(s.bytes)}）`);
    if (s.description && tip) lines.push(`- **技能自述**：${s.description.replace(/\s+/g, ' ').trim()}`);
    lines.push('');
  }

  if (others.length > 0) {
    lines.push('## 顺带一提：skills 目录里还有这些不是技能的东西');
    lines.push('');
    for (const o of others) lines.push(`- \`${o}\``);
    lines.push('');
    lines.push('（DSH 只认每个子目录里的 `SKILL.md`，上面这些不会被当成技能。）');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 这份清单怎么跟着走');
  lines.push('');
  lines.push('- 改完技能：双击同步助手 -> 菜单 4【保存并上传】');
  lines.push('- 换设备：先在那台设备 clone 技能库 -> 菜单 5【拉取更新】');
  lines.push('- 想手动看：这个文件就在技能库根目录，GitHub 网页上也能看到');

  const out = path.join(inRepo && fs.existsSync(root) ? root : TOOL_DIR, unit().catalogName);
  fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
  // 搬家之后清单归仓库管，把之前放在工具目录里的那份预览删掉，免得两份混淆
  if (inRepo) {
    const stale = path.join(TOOL_DIR, unit().catalogName);
    if (fs.existsSync(stale)) { try { fs.rmSync(stale); } catch { /* 忽略 */ } }
  }

  if (!silent) {
    head('技能清单');
    for (const s of list) {
      const tip = KNOWN_TIPS[s.dir];
      say(`  ${s.dir}`);
      say(`      ${(tip ? tip.一句话 : s.description || '（没写简介）').slice(0, 60)}`);
    }
    say();
    ok(`已写入：${out}`);
    say('   （这个文件会跟着仓库一起同步，两台设备都能看到）');
  }
  return out;
}

// ───────────────────────────────────────────────────────── 知识库清单 _清单.md

/** 刷新每个子库里的 _清单.md（自动生成）。
 *  INDEX.md 和 _说明.md 由人维护：AI 看不到 pptx/docx 里的内容，
 *  只能靠 _说明.md 里"每个文件一句用途"来判断要不要用。 */
async function actionInventory(silent = false) {
  const root = syncRoot();
  const kbRoot = path.join(root, unit().sub);
  const live = livePath();
  const scanRoot = fs.existsSync(kbRoot) ? kbRoot : live;
  if (!fs.existsSync(scanRoot)) {
    if (!silent) { bad(`还没找到${unit().dirLabel}：${scanRoot}`); info('先做第 1 步（菜单选 1）。'); }
    return [];
  }
  const SKIP = new Set(['_private', '_work', '.git', 'node_modules', '_sync-tool']);
  const dirs = fs.readdirSync(scanRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name))
    .map((d) => d.name).sort();
  const written = [];
  let undoc = 0;
  for (const name of dirs) {
    const dir = path.join(scanRoot, name);
    const files = [];
    const walk = (p, rel) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name === '_清单.md' || e.name.startsWith('.')) continue;
        const full = path.join(p, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else { const st = fs.statSync(full); files.push({ rel: r, size: st.size, mtime: st.mtime }); }
      }
    };
    try { walk(dir, ''); } catch { continue; }

    // 从 _说明.md 里抓"每个文件的用途说明"，形如：  - `文件名.pptx`：这是……风格，适合……
    const notes = {};
    const readme = path.join(dir, '_说明.md');
    if (fs.existsSync(readme)) {
      for (const line of fs.readFileSync(readme, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*[-*]\s*`([^`]+)`\s*[:：]\s*(.+)$/);
        if (m) notes[m[1].trim()] = m[2].trim();
      }
    }

    const lines = [];
    lines.push(`# ${name} · 文件清单`);
    lines.push('');
    lines.push('> 这个文件由同步助手自动生成，手改会被覆盖。要写说明请写进同目录的 `_说明.md`：');
    lines.push('> 格式 `- `文件名.pptx`：这句话是给 AI 看的，说清用途、风格、适用场合。');
    lines.push('');
    lines.push(`一共 ${files.length} 个文件，${human(files.reduce((n, f) => n + f.size, 0))}。`);
    lines.push('');
    if (files.length === 0) {
      lines.push('（这个子库还没有文件。）');
    } else {
      lines.push('| 文件 | 说明（来自 _说明.md） | 大小 | 修改时间 |');
      lines.push('|---|---|---|---|');
      for (const f of files) {
        const isDoc = path.basename(f.rel) === '_说明.md';
        const note = notes[f.rel] || notes[path.basename(f.rel)] || (isDoc ? '（本子库的说明文件）' : '');
        if (!note && !isDoc) undoc += 1;
        const when = `${f.mtime.getFullYear()}-${String(f.mtime.getMonth() + 1).padStart(2, '0')}-${String(f.mtime.getDate()).padStart(2, '0')}`;
        lines.push(`| \`${f.rel}\` | ${note ? note.replace(/\|/g, '/') : '（还没写说明）'} | ${human(f.size)} | ${when} |`);
      }
      const missing = files.filter((f) => path.basename(f.rel) !== '_说明.md' && !(notes[f.rel] || notes[path.basename(f.rel)]));
      if (missing.length > 0) {
        lines.push('');
        lines.push(`> 提示：上面有 ${missing.length} 个文件还没写说明。AI 读不到 pptx/docx 里的内容，`);
        lines.push('> 只能靠 `_说明.md` 里那句话判断该不该用它 —— 没写的文件等于找不到。');
      }
    }
    lines.push('');
    const out = path.join(dir, '_清单.md');
    const text = `${lines.join('\n')}\n`;
    const before = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (before !== text) { fs.writeFileSync(out, text, 'utf8'); written.push(`${name}/_清单.md`); }
  }
  if (!silent) {
    head('知识库清单');
    if (written.length === 0) ok('清单已经是最新的，没有变化。');
    else { ok(`已刷新 ${written.length} 个清单：`); written.forEach((w) => say(`     ${w}`)); }
    if (undoc > 0) warn(`有 ${undoc} 个文件还没写说明（在 _说明.md 里补一句就行）`);
    info('这些 _清单.md 会跟着仓库同步，AI 就靠它们找到你的文件。');
  }
  return written;
}

// ───────────────────────────────────────────────────────── 菜单

async function menu() {
  for (;;) {
    const s = gitState();
    const live = livePath();
    const scanDir = fs.existsSync(s.skillsRoot) ? s.skillsRoot : live;
    const link = s.link;
    say();
    say(LINE);
    say(`  DSH 云同步助手 · ${unit().label}库          ${IS_WIN ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'}`);
    say(LINE);
    say(field(unit().dirLabel, live, 10));
    say(`              ${link && link !== '' ? `-> 链接到 ${link}` : link === '' ? '真实目录（还没接管）' : '不存在'}`);
    if (unit().catalogMode === 'skills') {
      const skills = scanSkills(scanDir);
      say(field('技能数量', `${skills.list.length} 个（${skills.list.reduce((n, x) => n + x.files, 0)} 个文件，${human(skills.list.reduce((n, x) => n + x.bytes, 0))}）`, 10));
    } else {
      const st = walkStats(scanDir);
      say(field('文件数量', `${st.files} 个，${human(st.bytes)}`, 10));
    }
    say(field('同步文件夹', `${s.root}${s.rootExists ? '' : '  (不存在)'}`, 10));
    say(field('同步仓库', s.remote || '未设置', 10));
    const gitVer = GIT ? run(GIT, ['--version']).stdout : '';
    say(field('git', gitVer || (GIT ? '找到了但没法执行' : '未找到（需要先安装 git）'), 10));
    say();
    say(`  建议下一步：${await nextStepText()}`);
    say();
    say('  第一次使用（按顺序做 1 -> 2 -> 3）：');
    say(`    1  把${unit().label}搬进同步文件夹并接管`);
    say('    2  连接 GitHub 仓库（建仓库 / 填地址 / 测通）');
    say('    3  首次上传到 GitHub');
    say(THIN);
    say('    4  日常：保存并上传');
    say('    5  日常：拉取更新（换设备/另一台改完后）');
    say('    6  体检：看看现在什么状态');
    say(unit().catalogMode === 'skills'
      ? '    7  生成技能清单 SKILLS.md'
      : '    7  刷新各子库文件清单（_清单.md）');
    say(`    8  换新设备：克隆${unit().label}库并接管`);
    say('    0  退出');
    say();
    const choice = await ask('请输入数字', '');
    say();
    switch (choice) {
      case '1': await actionLink(); break;
      case '2': await actionRemote(args.url); break;
      case '3': await actionPush(true); break;
      case '4': await actionPush(false); break;
      case '5': await actionPull(); break;
      case '6': await actionStatus(); break;
      case '7': await actionCatalog(false); break;
      case '8': await actionClone(args.url, args.root); break;
      case '0': say('  再见。'); return;
      default: warn('请输入 0 到 8 之间的数字。');
    }
  }
}

// ───────────────────────────────────────────────────────── 命令行入口

function parseArgv(argv) {
  const out = { _: [], yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) out[key] = true;
      else { out[key] = val; i += 1; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgv(process.argv.slice(2));

function usage() {
  say('DSH 云同步助手（技能库和知识库共用一个工具）');
  say('');
  say('  最常用：直接双击 同步助手.cmd（技能库）或 知识库助手.cmd（知识库），按菜单数字选。');
  say('');
  say('  命令行也行，默认操作技能库，加 --unit kb 就是知识库：');
  say('    node skills-sync.mjs status                     体检');
  say('    node skills-sync.mjs link                       第1步：搬家+接管');
  say('    node skills-sync.mjs remote --url <仓库地址>     第2步：连接 GitHub');
  say('    node skills-sync.mjs push                       第3步：首次上传');
  say('    node skills-sync.mjs save                       日常：保存并上传');
  say('    node skills-sync.mjs pull                       日常：拉取更新');
  say('    node skills-sync.mjs catalog                    生成清单（知识库=刷新 _清单.md）');
  say('    node skills-sync.mjs clone --url <仓库地址> [--root <目录>]   换新设备');
  say('');
  say('  可选参数：--unit kb  --root <同步文件夹>  --home <用户目录>');
  say('            --skills-dir <技能目录>   --kb-dir <知识库目录>');
  say('            --yes（不再问）  --allow-big / --allow-risky（跳过上传前的拦截）');
}

async function main() {
  if (args.help) { usage(); return; }
  if (!GIT) {
    bad('没有找到 git。请先安装：');
    info(IS_WIN ? 'winget install --id Git.Git -e' : 'macOS: xcode-select --install');
    return;
  }
  const cmd = args._[0];
  if (!cmd) {
    if (process.stdin.isTTY) { await menu(); return; }
    usage();
    return;
  }
  switch (cmd) {
    case 'status': await actionStatus(); break;
    case 'link': await actionLink(); break;
    case 'remote': await actionRemote(typeof args.url === 'string' ? args.url : ''); break;
    case 'push': case 'save': await actionPush(cmd === 'push'); break;
    case 'pull': await actionPull(); break;
    case 'catalog': await actionCatalog(false); break;
    case 'clone': await actionClone(typeof args.url === 'string' ? args.url : '', typeof args.root === 'string' ? args.root : ''); break;
    default: usage();
  }
}

main().catch((e) => {
  say();
  bad(`出错了：${e.message}`);
  say('  如果是文件被占用之类的，关掉 DSH 再试一次。');
  process.exitCode = 1;
});
