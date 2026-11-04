# 双人协作约定

PAI 是两人小团队开发 + 作者自用（dogfooding）的项目。这份文档固化我们的协作方式，新成员克隆后先读完再动手。

## 环境准备

- **Node 版本**：见 `.nvmrc`（当前 24）。better-sqlite3 是原生模块，两人必须用同一大版本（`nvm use` 即可），否则装出的二进制不一致。
- `npm install` → `npm run dev` → http://localhost:3000（首次访问自动建库 `data/pai.db`）。
- **行尾**：仓库有 `.gitattributes`（统一 LF），克隆即用无需配置。建议顺手 `git config core.quotepath false`，中文文件名才能正常显示。
- **Windows 注意**：`npm run dev` 已固定 webpack——本机 Turbopack 有必现崩溃问题，不要去掉 `--webpack`。
- **API Key**：复制 `.env.local.example` 为 `.env.local`，或在设置页界面化配置。任何 Key 都不能进仓库。

## 分支与提交

- `main` 始终可运行：`npm run build` 通过、现有 e2e 不红。
- 开发一律从 `main` 切分支：功能 `feat/<模块>-<一句话>`（如 `feat/graph-evidence-panel`）、修 bug `fix/<一句话>`。
- 完成后发 PR，**由另一人 review 后再 merge**（schema / prompt / 公共组件这类高影响改动必须有人第二双眼睛）。合并用 squash，合并后删分支。
- PR 描述写清两件事：**改了什么**、**如何验证**（跑过哪条 e2e / 截图）。
- commit 风格：`feat:` / `fix:` / `chore:` / `docs:` + 中文描述，保持现有风格。
- 每天开工先 `git pull --rebase origin main`；小步提交，一个分支只做一件事。
- 规划与缺陷进 **Issues**（含 Milestone：M2.5 复盘指标 / V0.6），不口头转达。

## 冲突热点约定（重要）

以下文件/目录是两人最容易撞车的地方：

1. **DB schema**（`src/lib/db/index.ts` + `src/lib/db/repo/`）：无迁移框架，建表是手写 SQL。schema 变更**单独成 PR**；只做纯增量——新表用 `CREATE TABLE IF NOT EXISTS`，加列用 try-ALTER 风格；**不改动他人已建的表定义**。
2. **`scripts/mock-llm.mjs`**：按 `system.includes(...)` 分发。只在自己的 prompt 分支前 **append 新 handler**，不重排他人代码块。
3. **`src/lib/llm/prompts/`**：新功能 = 新 prompt 文件（如 `note-ask.ts`）；`client.ts` / `types.ts` 等共享文件的改动收敛进 schema PR，或提前在 Issue 里说明。
4. **`scripts/e2e-*.mjs`**：断言**追加到文件尾部**，不重排既有段落。
5. **公共组件**（`src/components/common/` 等）：跨模块改动先在 Issue/PR 里说一声再动。

## 数据与秘密

- `data/pai.db`（本地 SQLite，**含个人学习数据**）与 `.env*` 永不进 git（已 ignore）。
- 需要测试场景一律用 `scripts/seed-test.mjs` 造数据，不共享真实库；dogfooding 数据各自本地备份。

## 验证命令

```bash
npm run build                      # 必须通过
node scripts/seed-test.mjs         # dev 启动后运行：14 项业务规则断言
node scripts/unit-diagram.mjs      # 无需 dev，可单独跑

# e2e 三件套（先起 dev + mock LLM 两个进程）：
node scripts/mock-llm.mjs          # 终端 1：mock LLM，监听 :5099
npm run dev                        # 终端 2：应用 :3000（需配置 base_url 指向 mock）
node scripts/e2e-b4b5.mjs          # 终端 3：17 项
node scripts/e2e-notes-mgmt.mjs    # 20 项
node scripts/e2e-diagram.mjs       # 17 项
```
