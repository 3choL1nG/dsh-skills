# START-HERE · Mac 第一次接入

> **这个文件是给 Mac 上的 AI 读的入口。** 人要做的只有一步：把下面这句话
> 发给 Mac 上一个**新开的对话框**。

**复制这一句（发给 Mac 上的 AI）：**

```
请读 https://raw.githubusercontent.com/3choL1nG/dsh-skills/main/START-HERE.md ，
然后一步一步带我把这台 Mac 接进我的知识库和技能同步系统。
每一步先说清为什么、再让我操作，我做完你验证一次再进入下一步。
```

如果 AI 读不了网，就在浏览器里打开这个页面看同样内容：
`https://github.com/3choL1nG/dsh-skills/blob/main/START-HERE.md`

---

## 一、背景（AI 读完这段就够，不用问用户）

- 用户在 **Windows（已配好、已验证）** 和 **Mac（这一台，还没接）** 之间同步两样东西，
  用 GitHub 做中转，两台机器各自保留一份工作副本：
  - 技能库 `dsh-skills`：DSH 的技能 + 同步工具本体（`_sync-tool/`）
  - 知识库 `dsh-kb`：资料库，子库 `01-视觉规范` `02-模板` `03-产出` `04-公文范文` `05-素材` `06-方法论`
- 两个仓库都是**公开**的；`_private/`、`_work/` 永不推送。
- 工具是零依赖的 Node 脚本：`<clone>/_sync-tool/skills-sync.mjs`，带编号菜单。
- 接管之后，「知识库取用/归档规则」会写进 `~/.dsh/AGENTS.md`，
  **之后任何新对话都会自动具备归档能力**，不必再读本文件。

## 二、带用户做的 5 步（每步做完验证一次）

1. **查环境**
   - **先确认这台 Mac 已经装了 DSH**：`ls ~/.dsh` 里有东西（会有 `AGENTS.md`、`dsh-runtimes` 这些）。
     没有就先装好 DSH、打开一次，再回来做这 5 步 —— 否则后面技能和规则没地方生效。
   - `git --version`：没有会弹出"安装命令行工具"窗口 → 点安装；或跑 `xcode-select --install`
   - `node -v`：没有也不要紧（接管脚本会自己去找 DSH 自带的 Node；实在没有就 `brew install node`）
2. **克隆两份仓库**
   ```bash
   git clone https://github.com/3choL1nG/dsh-skills.git ~/DSH-Skills
   git clone https://github.com/3choL1nG/dsh-kb.git ~/KB-Sync
   chmod +x ~/DSH-Skills/_sync-tool/*.command
   ```
   克隆完读一遍 `~/DSH-Skills/使用说明.md`（那是给人看的说明书，很短）。
3. **知识库接管**：让用户双击 `~/DSH-Skills/_sync-tool/知识库助手.command` → 按 **`8`**
   （换新设备：克隆并接管）。它会问"要不要把知识库规则装进 `~/.dsh/AGENTS.md`" → 选 **`y`**
   （只写进 `<!-- DSH知识库规则:start -->` 标记的那一段，改动前留一份 `.bak`）。
4. **技能接管**：双击 `同步助手.command` → 按 **`8`**。
5. **重开一次 DSH**（让技能生效）。

## 三、验收（别跳，这决定了以后顺不顺）

- 两个助手各按一次 **`6`**（体检）：应显示"领先 0 个提交，落后 0 个提交"
- 确认链接已建立：`ls -ld ~/KB ~/.agents/skills` → 两个都应是软链接（`->`）
- 确认规则已装：`grep -c DSH知识库规则 ~/.dsh/AGENTS.md` → 应 ≥ 1
- **新开一个对话框**问："我的知识库在哪、收件箱是干什么的" → 不看本文件也应答得出来
- 让用户在 `~/KB/_inbox` 丢一个测试文件 → 说"归档收件箱" → 按规则走完整流程
  （读内容 → 归类 → 移动 → 写说明 → 刷新清单 → 上传 → 给表格）

## 四、Mac 特有的坑

- **Python 库**：归档读文件助手需要 `python-pptx` / `python-docx` / `openpyxl`。
  缺了它会给提示，装法：`pip3 install --user python-pptx python-docx openpyxl`；
  也可以改用 `office-pptx` / `office-docx` / `office-xlsx` 技能来读。
- **路径**：Mac 上知识库是 `~/KB`（→ `~/KB-Sync/kb`），技能目录是 `~/.agents/skills`（→ `~/DSH-Skills/skills`）。
- **别按 `1`**：新建目录那条会把 Mac 上的东西当成新的；要按 **`8`**，它会把 Mac 上已有的
  技能/文件**并进来**，不覆盖任何东西。
- **网络不稳**：工具上传会自动重试 4 次；还失败就再按一次 `4`，改动不会丢（已提交在本机）。
- **私人文件**：不方便公开的放 `~/KB/_private/`（永不上传，但也**不会**同步到另一台）。
