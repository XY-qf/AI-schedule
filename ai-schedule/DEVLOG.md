# 开发记录（DEVLOG）

> 项目：AI 日程（个人版）
> 依据：`../AI日程_开发计划_v1.0.md`
> 记录方式：每个里程碑完成后追加一节，写明完成项、测试数、偏差与遗留。

---

## 0. 环境结论（第 0 天技术验证）

| 项 | 结论 |
| --- | --- |
| Node | v24.21.0（不在 PATH，需用绝对路径调用） |
| 包管理器 | pnpm 11.7.0（`pnpm install` 需放宽权限：要写用户缓存并启动安装脚本） |
| npm registry | 可达（走 npmmirror 镜像更快） |
| MSVC 编译工具 | **无** → 不能编译原生模块 |
| git | 未安装（暂用文件系统快照代替版本管理） |
| C 盘可用空间 | 580 GB |
| Electron 运行时 | 已下载 v33.4.11（188 MB），但**在本会话内无法启动**（见下） |

### 关键偏差 1：SQLite 驱动改用 sql.js（WASM）

原计划 better-sqlite3。放弃原因：

1. 本机无 MSVC，无法编译原生模块；
2. 更致命的是 **ABI 冲突**：测试跑在 Node 24，程序跑在 Electron 内置 Node 20，同一个原生模块需要两套 ABI，来回重建极易出错。

改用 `sql.js`（SQLite 官方 C 代码编译成的 WASM）：同一份代码在 Node 测试与 Electron 里行为完全一致，且天然满足 PRD 4.2 要求的“先写临时文件再替换正式文件”。落盘策略为：每次写入后导出整库 → fsync → 原子 rename。风险表中已把此方案列为备选，属于按计划降级。

### 关键偏差 2：测试框架改用 Node 内置 node:test

原计划 Vitest。放弃原因：Vitest 依赖 esbuild，esbuild 会启动子进程服务，在当前沙箱里 `spawn EPERM`，测试根本跑不起来。

改用：`tsc` 编译 + Node 内置测试运行器（同进程加载全部测试文件）+ 自写的极简 `expect` 封装 + jsdom 手工搭建 DOM 环境。**没有任何子进程**，测试稳定可跑。

### 关键偏差 3：Electron 窗口无法在本会话验证

现象：`electron .` 启动后主进程脚本能加载（`module-loaded` 能写出），但 `app.whenReady()` 永不触发，进程以 0xC0000005 退出。最小复现应用同样如此。

结论：当前受限会话无法创建 Chromium 浏览器进程，**不是代码问题**。影响：

- 所有逻辑与界面测试照常可跑（不依赖 Electron）；
- “窗口能打开”这一条只能由使用者在桌面上双击验证（`启动.bat`）。

---

## 1. M0 骨架（已完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-01 项目初始化 | ✅ | Electron 33 + React 19 + TypeScript + Vite 5；主进程用 tsc 编译，界面用 Vite 打包 |
| T-02 主窗口与窗口状态 | ✅ | 窗口尺寸/位置/最大化/上次页面与视图，存在设置表；非法值一律退回默认 |
| T-03 设计令牌与基础组件 | ✅ | 颜色、字号层级、间距按 PRD 第 10 章；按钮/输入/勾选/下拉/分段控件/弹窗/提示条/空状态 |
| T-04 导航/工具栏/状态栏骨架 | ✅ | 左侧六项导航（设置单独分隔）、翻页与标题随视图变化、状态栏显示数据位置与备份时间 |
| T-05 数据能力验证 | ✅ | SQLite 建表、写入、重开仍在；损坏文件抛明确错误 |

**本阶段测试：98 项全部通过**（`pnpm test`，实为 tsc + node:test）。

覆盖要点：

- 日期与时间：跨月跨年、闰年 2/29、月末 31 日、周一起始、学期周次、单双周、24:00 归次日、中文格式
- 数据层：建表、重开数据仍在、原子写不留残渣、损坏文件报错、事务回滚、关闭后使用报错
- 路径：文档目录推导、自动建目录、盘符不可用时的中文错误
- 设置与窗口状态：默认值、往返、夹紧、非法值回退
- 界面：7 个基础组件 + 导航 + 工具栏 + 状态栏 + 整体框架，共 30 项交互断言

### 已修缺陷

1. `Number('')` 得 0 导致窗口尺寸被夹到最小值 → 空字符串按“无值”处理。
2. 事务进行中仍逐条落盘 → 事务期间只标记，提交后统一落盘；并禁止嵌套事务。
3. JSX 属性里的 `\\` 不转义（测试写法问题）→ 改用表达式。
4. `Error.cause` 参数属性与基类冲突 → 改名 `detail`。

### 遗留（不阻塞下一步）

- `vitest` 仍在 devDependencies 里但已不使用，收尾时移除。
- `_build`、`dist-test`、`.electron-cache` 属于生成物，收尾时清理或忽略。

---

## 2. M1 存储（已完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-06 表结构与迁移 | ✅ | 8 张表 + 索引 + `PRAGMA user_version` 迁移框架 |
| T-07 数据仓储层 | ✅ | 日程 / 学期 / 作息时间表 / 课程 四套仓储，含中文校验错误 |
| T-08 安全写入与事务 | ✅ | 事务期间只标记、提交后统一落盘；禁止嵌套事务 |
| T-09 自动备份 | ✅ | 每日首次 + 退出时；保留 10 份滚动删除；失败记状态不抛给界面 |
| T-10 备份与恢复 | ✅ | 恢复前校验备份可打开 → 自动给当前数据做安全备份 → 原子覆盖 |
| T-11 路径异常提示 | ✅ | 目录不可建/不可写抛出中文错误，主进程弹窗提示且不建空库 |

**本阶段新增测试 61 项（累计 159 项全部通过）。**

关键设计：

- 备份文件名 `schedule-2026-03-04_0900.db`，可反解出时间，按文件名天然可排序。
- 恢复流程的三道保险：先 open 备份做完整性校验 → 给当前数据写 `before-restore-*.db` → 原子覆盖。任何一步失败当前数据都不受损。
- 安全备份不参与 10 份滚动删除（否则救命的副本会被清掉）。

### 已修缺陷

5. 全天条排序不稳定且把待办排在跨天事件前 → 改为「跨度长优先 → 全天优先于待办 → 起始列 → 标题」。

---

## 3. M2 日历基础（已完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-12 周视图网格 | ✅ | 24 小时时间轴（每小时 48px）、七列、今天高亮、全天条、双击小时格新建 |
| T-13 日程块渲染 | ✅ | 按分钟定位、分类色、两行信息、过短只显示标题、重叠并排、已完成划线 |
| T-14 全天条 | ✅ | 全天/跨天/待办条目按列跨列显示，跨天带左右截断标记 |
| T-15 新建/编辑弹窗 | ✅ | 四种时间形态、中文校验、冲突黄条提示但不阻止保存、标题为空禁用保存 |
| T-16 只读详情面板 | ✅ | 浏览态只读并提示"进入编辑态后可修改"；编辑态给编辑/完成/删除 |
| T-17 浏览态与编辑态 | ✅ | 双击行为按状态分流：浏览态只开详情，编辑态才开编辑窗口 |
| T-18 翻页与快捷键 | ✅ | ←/→ 翻页、T 回今天、Ctrl+N 新建、Esc 关闭；输入框内不误触发 |

**本阶段新增测试 55 项（累计 214 项全部通过）。**

配套打通了整条链路：`界面 → preload → IPC → 仓储 → SQLite`，并用假接口写了 16 项端到端交互测试（点块开详情、编辑态双击开窗、双击空白按小时预填、保存后列表刷新、标记完成、删除）。

界面产物：`dist/renderer` 打包通过（CSS 12.7KB / JS 249KB）。

### 已修缺陷

6. 全天条排序不稳定且待办排在跨天事件前 → 「跨度长优先 → 全天优先于待办 → 起始列 → 标题」。
7. 日程块 `editing` 属性未使用（编辑态没有视觉区分）→ 补 `is-editable` 类。
8. 测试里对翻页周次的预期算错（3 月 4 日往前两周是 2 月 25 日，属 2 月第 5 周）→ 修正断言。

---

## 4. M3 完整日历与编辑能力（大部分完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-19 拖拽 | ✅ | 仅编辑态：拖动平移、拉下边缘改时长；5 像素阈值防误触；15 分钟吸附 |
| T-20 撤销 | ✅ | 删除、拖动、改时长后底部提示条可撤销；提示条 5 秒自动消失，也可手动关 |
| T-21 日视图 | ✅ | 单日时间轴、现在红线、当天面板（待办 + 空闲时段 + 合计） |
| T-22 月视图 | ✅ | 42 格六行七列、今天高亮、非本月灰显、每格 3 条 + N 更多、双击新建 |
| T-23 列表视图 | ✅ | 按天分组、今天/明天相对标签、组内按时间排序、30 天窗口、空状态 |
| T-24 完成标记 | ✅ | 列表勾选、详情面板按钮、日历块灰显划线 |
| T-25 重复规则引擎 | ◐ 仅逻辑层 | 展开算法（每天/每周/每两周/每月/每年/自定义 + 截止日期/次数 + 例外）已完成并有 22 项测试；**尚未接入存储表与设置界面** |

**本阶段新增测试 69 项（累计 283 项全部通过）。**

### 已修问题

9. 重复引擎的周规则从"开始日"而非"该周周一"起算，导致周中开始的规则算错星期 → 改为按周一对齐。
10. 测试里 px→分钟的换算算错（48px 是 60 分钟，不是 75）→ 修正断言。
11. **测试进程挂死**：`waitFor` 在 React `act` 环境里互相等待，测试永不结束 → 该用例改为等待固定时长后直接断言；同时给运行器加 20 秒兜底强制退出。
12. jsdom 开了 `pretendToBeVisual` 会启动持续动画帧循环，让进程无法退出 → 关闭。

---

## 5. T-25 收尾与 M4 课程表（部分完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-25 重复规则存储 | ✅ | recurrences 表仓储（星期以 JSON 存）、日程例外仓储（同一天覆盖）、课程例外仓储 |
| T-26 学期管理 | ◐ 逻辑层 | 仓储已完成（含删除连带），界面待接 |
| T-27 课程录入 | ✅ 组件层 | 课程弹窗：节次/具体时间两种方式、单双周、周次范围、中文校验 |
| T-28 作息时间表 | ◐ 逻辑层 | 仓储已完成（整表替换、恢复默认、校验），编辑弹窗待做 |
| T-29 课程自动排布 | ✅ | 周次范围 + 单双周 + 节次换算 + 停课/调课例外，全部有测试 |
| T-30 调课与停课 | ◐ 逻辑层 | 例外仓储与展开规则已实现，操作入口待接 |
| T-31 课程表页 | ✅ 组件层 | 课表网格、课程块按节数跨行、双击空格新建、学期切换与提示 |

**本阶段新增测试 42 项（累计 325 项全部通过）。**

课程排布引擎的关键规则都有测试兜底：

- 学期 18 周、1–16 周每周一上课 → 正好 16 次
- 单周课 → 8 次，日期正确
- 停课的那一次消失，其它周次不变
- 调课的那一次改到新时间，**原位置不再出现**（方案 B）
- 同一格单双周两门课都能排出来
- 学期开始之前、不属于该学期的课程都不出现

### 已修问题

13. `courseUi.ts` 的 import 路径写成 `../../shared/...`（它自己就在 shared 里）→ 改为同级引用。

---

## 6. M4 课程表（界面接入完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-26 学期管理 | ✅ | 学期弹窗（名称/开学日期/总周数/删除连带提示）+ 学期下拉切换 |
| T-27 课程录入 | ✅ | 课程弹窗接上数据库，双击格子预填星期与节次 |
| T-28 作息时间表 | ✅ | 作息弹窗：增删行、改时间、恢复默认、校验 |
| T-29 课程自动排布 | ✅ | 课程实例并进日历（切换视图都能看到，颜色归入课内蓝） |
| T-30 调课与停课 | ◐ | 仓储 + IPC + 展开规则齐了，**操作入口（课程小卡）还没做** |
| T-31 课程表页 | ✅ | 网格、跨行课程块、学期切换、周次提示 |

**本阶段新增测试 13 项（累计 338 项全部通过）。**

### 已修缺陷（重要）

14. **弹窗表单不重置**：三个弹窗组件常驻挂载、只切 `open` 属性，初始化只跑一次，
    导致"双击 3-2 格子新建"实际用了上一次的默认值、编辑时课名是空字符串。
    给 CourseDialog / SemesterDialog / PeriodsDialog 都加了 `open` 变化时的重置 effect。
    这个 bug 只有在"先打开过一次再打开"的序列里才会暴露。

---

## 7. T-30 调课与 M5 分类页（已完成）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-30 调课与停课 | ✅ | 课程块选中后：仅这一次改期（弹窗选日期时间）、本次停课、撤销例外；例外参与日历展开 |
| T-32 课外活动页 | ✅ | 即将到来 / 更早（可展开）、已完成可切换显示、勾选完成、新建入口 |
| T-33 个人生活页 | ✅ | 与课外页同构，按分类取数 |
| T-34 待办页 | ✅ | 逾期/今天/本周/以后分组 + 数量、已完成折叠展开、空组不渲染 |
| T-35 待办进全天条 | ✅ | M2 已实现（待办在日历全天条里显示） |

**本阶段新增测试 29 项（累计 367 项全部通过）。**

### 已修问题

15. `openCreate` 没把 `kind` 传给弹窗默认值 → 待办页点「新建待办」实际建的是时间段日程。补上透传。
16. 原有测试断言"待办（下一步实现）"占位文案，页面做出来后失效 → 改为断言真实页面元素。

### 测试踩坑记录（重要）

`waitFor` 在 React `act` 环境里会与测试互相等待导致进程挂死。统一改用"等待固定时长后直接断言"的 `flush()`，
并在运行器里保留 20 秒兜底强制退出。

---

## 8. M6 收尾（进行中）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T-36 设置页 | ✅ | 数据位置与打开文件夹、立即备份、备份清单与二次确认恢复、类别颜色、显示偏好、关于 |
| T-37 首次使用引导 | ✅ | 无数据时显示三步引导；点"先建课程表"直接跳课程表并打开学期弹窗 |
| T-38 右键菜单与批量 | ⏳ 未做 | 见下 |
| T-39 边界打磨 | ◐ | 弹窗重置、空态、周次提示已覆盖；长标题、大面积数据待验 |
| T-40 性能 | ⏳ 未做 | 待造 5000 条实测 |
| T-41 打包 | ✅ | 安装版 + 免安装版 + 解包版都产出了，产物完整（见下） |
| T-42 全量验收 | ⏳ 未做 | |

**本阶段新增测试 13 项（累计 380 项全部通过）。**

### 已修问题

17. 首次引导页改变了"空数据时的界面"，导致 9 个旧测试找不到周视图 → 给这些测试补一条示例日程，
    让它们测的是日历本身而不是首次状态。

---

## 9. 打包产物与的一个坑

| 产物 | 大小 | 说明 |
| --- | --- | --- |
| `release\AI日程-Setup-1.0.0.exe` | 89.3 MB | 安装版，可选安装目录、建桌面快捷方式 |
| `release\AI日程-1.0.0-portable.exe` | 89.1 MB | 免安装版，双击即用 |
| `release\win-unpacked\AI日程.exe` | — | 解包版，便于排查 |

已核对 asar 内容：`dist/main`、`dist/preload`、`dist/renderer`、`node_modules/sql.js`（含 `sql-wasm.wasm`）全部在内。

**打包踩的坑**：electron-builder 在 Windows 上要下载 winCodeSign（里面含 macOS 的符号链接），
创建符号链接需要管理员权限，直接失败。预解压无效（它每次用随机目录名）。
最终用 `win.signAndEditExecutable: false` 绕开——代价是 exe 的图标与版本信息没写进去，
程序本身功能不受影响。

---

## 10. 当前进度与阻塞（第 9 轮）

已完成：M0–M5 全部；M6 的设置页、首次引导、打包。

| 任务 | 状态 |
| --- | --- |
| T-36 设置页 | ✅ |
| T-37 首次引导 | ✅ |
| T-38 右键菜单 | ✅ 代码 + 10 项测试已写，最后一次修复未复跑 |
| T-39 边界打磨 | ◐ 主要项已覆盖 |
| T-40 性能实测 | ⏳ 未做 |
| T-41 打包 | ✅ 安装版 + 免安装版已产出 |
| T-42 全量验收 | ◐ `验收清单.md` 已产出，需在真机补手工项 |

### 阻塞：Shell 无法执行（已在第 10 轮解除）

恢复后确认执行策略已变为 `LocalMachine = RemoteSigned`。解除后立刻复跑，全部通过。

---

## 11. 第 10 轮：恢复后补完的部分

| 事项 | 结果 |
| --- | --- |
| 右键菜单复跑 | ✅ 390 项全绿（含之前修好但未验证的"课程块"用例） |
| T-40 性能实测 | ✅ 新增 4 项性能测试，数据见下 |
| 重新打包 | ✅ 用最新代码重打（含右键菜单），release 下产物已更新 |
| 使用说明 | ✅ `使用说明.md` |

### 5000 条数据实测

| 场景 | 耗时 |
| --- | --- |
| 批量写入 5000 条 | 44 ms |
| 周视图取一周（命中 98 条） | 34 ms |
| 月视图 42 天分桶（588 条） | 26 ms |
| 30 门课排 18 周（400 次） | 1 ms |

结论：数据量到 5000 条时，视图切换在几十毫秒量级，远低于计划里"1 秒内"的目标。

**测试总数 394 项，全部通过。**

### 仍未验证的一项

打包后的程序**在本会话内仍然起不来**（连数据目录都没创建）。这与之前用最小 Electron 程序复现的结果一致：
本会话无法创建 Chromium 浏览器进程。所以"双击能打开"这条只能由使用者在桌面上验证。

---

## 13. 第 11–12 轮：重复日程全线打通

| 事项 | 结果 |
| --- | --- |
| 展开层 | `shared/occurrences.ts`：母事件展开成日历条目，实例 id `母事件id#原日期` |
| 重复规则 IPC | 7 个接口贯通（规则增删改查 + 例外增删查） |
| 弹窗重复设置 | 新建/编辑弹窗里可选 不重复/每天/每周/每两周/每月/每年 + 结束条件（到某日 / 共几次） |
| 三选一弹窗 | `ScopeDialog`：仅这一次 / 这一次及以后 / 全部 |
| 三选一落地 | 仅这一次 → 写例外；全部 → 改母事件/删整个系列；这一次及以后 → 老系列截断到前一天 |
| 日历展开 | 日历上直接显示展开后的实例，改期/跳过即时生效 |

**测试总数 419 项，全部通过。**

### 已修问题

18. **编辑重复日程的某一次打不开弹窗**：`handleOpenEditor` 在原始 `events` 里按 id 查找，
    而实例 id（`m1#2026-03-04`）只存在于展开后的列表里 → 改成在 `allEvents` 里找。
    这个问题是"三选一"的端到端测试直接逼出来的：点删除没反应，一查才发现弹窗压根没开。












---

## 14. 第 13 轮：窗口打不开的根因与修复

### 现象

双击打包后的程序，没有任何窗口，进程静默退出。

### 定位过程

| 步骤 | 结果 |
| --- | --- |
| 读取退出码 | 不带参数  x80000003（STATUS_BREAKPOINT）、带 --no-sandbox --disable-gpu  xC0000005（访问违例） |
| Chromium 日志 | 完全没有生成，说明崩在日志初始化之前 |
| Windows 事件日志 | 没有应用崩溃记录 |
| 环境检查 | VC++ 运行库齐全、Smart App Control 关闭、无第三方杀软注入 |
| 解析 minidump | 异常发生在 electron.exe 自身，模块列表只有系统 DLL，**没有第三方注入** |
| 换 Electron 44 | 同样  x80000003 → **不是版本问题** |
| 试 5 组参数组合 | 全部崩溃 → 不是 GPU/沙箱开关能解决的 |
| **复制到 C:\ai-test（纯英文路径）** | **正常运行，成功创建 schedule.db 与 backups** |
| 英文文件名 + 中文父目录 | 崩溃 |

### 结论

**这台机器上 Electron 无法从含非 ASCII 字符的路径启动**。用户目录是中文，所以桌面、
下载、文档这些位置都不行。这是 Electron/Chromium 在 Windows 上的路径兼容问题，
与本项目代码无关，换版本也解决不了。

### 修复

1. productName 改为 AI-Schedule（exe 与安装目录不带中文）
2. NSIS 改 perMachine: true → 默认装到 C:\Program Files\AI-Schedule
3. 桌面快捷方式仍叫「AI日程」（.lnk 指向英文路径，不受影响）
4. 免安装版改为 ZIP，说明要求解压到 C:\AI-Schedule
5. 新增 main/pathGuard.ts：路径含非 ASCII 字符时给中文提示再退出（5 项单测）

### 验证

- 纯英文路径：程序存活、创建 schedule.db(94 KB) 与 backups ✅
- 中文路径：仍崩溃（Electron 自身限制），已在说明里写明规避方式

**测试总数 424 项，全部通过。**

---

## 15. 第 14 轮：第一版反馈 12 条修复

| # | 问题 | 根因 | 处理 |
| --- | --- | --- | --- |
| 1 | 界面简陋 | — | 新增 appearance.css + 重做 tokens.css（三级阴影、圆角、字号层级、导航强调条、胶囊分段控件、按钮渐变、焦点环、细滚动条） |
| 2 | 菜单栏英文 | 用了 Electron 默认菜单 | 新增 main/appMenu.ts，全中文菜单（文件/编辑/视图/帮助） |
| 3 | 多开窗口 | 无单实例锁 | requestSingleInstanceLock + second-instance 聚焦已有窗口 |
| 4 | 只有开始时间 / 取消待办特殊类 | — | 新增 startOnly 类型，四种时间形态；待办改名「只有截止时间」，可放任何分类；startOnly 显示在全天条 |
| 5 | 拖动/拉长没结果 | handleMoveEvent 只认普通日程 | 新增 applyReschedule：普通日程改库、课程块写调课例外、重复实例写改期例外，都可撤销 |
| 6 | 叉号退出程序 | — | 关窗改为隐藏 + 托盘（显示/新建/退出），before-quit 才真退出并备份 |
| 7 | 每两周只重复两次 | 母事件滚出视图范围就查不到 | 新增 listAllEvents，日历加载全部日程后再按视图范围展开 |
| 8 | 课程表不显示按时间录入的课 | 网格只认节次字段 | 新增 coursePeriodSpan，用时间区间换算占第几节 |
| 9 | 能输入 66666 年 | 日期校验没有年份范围 | MIN_YEAR=1900 / MAX_YEAR=2100 |
| 10 | 待办不显示 | 同 7：截止日不在视图范围就不加载 | 同 7 |
| 11 | 「这一次及以后」日程消失 | 新系列复用了已被截断的老规则 | 新增 splitSeriesFollowing：老系列截断 + 新系列单独建规则 |
| 12 | 重复日程只显示一周 | listInRange 只返回自身日期在范围内的日程 | 同 7 |

**新增测试 19 项，总数 443 项全部通过。**

### 端到端验证

用打包后的程序跑自带自检（AI_SCHEDULE_SELFTEST=1）：
界面渲染出 6 个导航项、标题「2026年10月 第3周」、preload 通道可用、数据落在
文档\AI日程\schedule.db —— 说明打包产物能真正跑起来。

---

## 16. 第 15 轮：AI 课程助手（自然语言 / 课程表截图 → 待确认草稿 → 入库）

### 目标

课程表页顶部加一个入口，让用户「说一句话」或「贴一张课程表截图」，由本机的
`onnx-community/Qwen3.5-2B-ONNX-OPT`（q4f16）通过 tool call 把课**逐条写进**
一个「待确认」编辑界面，用户检查/修改/删除后点「全部加入课程表」才真正入库。

### 结构

| 文件 | 职责 |
| --- | --- |
| `renderer/ai/types.ts` | 引擎/事件/草稿的结构定义（无重依赖，测试与界面共用） |
| `renderer/ai/config.ts` | 模型 ID、来源（官方/镜像/自定义）、设备、精度档位与**精度降级梯子**、设置键 |
| `renderer/ai/draft.ts` | 字段归一化（星期/节次/周次/单双周/时刻，中英文都认）+ tool call → 草稿列表的归约 |
| `renderer/ai/tools.ts` | 5 个工具的 JSON Schema、系统/用户提示词、兜底 JSON 解析 |
| `renderer/ai/courseAiWorker.ts` | Web Worker：Transformers.js 的 WorkerHandler + ORT wasm 本地化 + 模型源配置 |
| `renderer/ai/engine.ts` | Vercel AI SDK：`streamText` + `tools` + `stepCountIs`，把 tool call 变成界面事件 |
| `renderer/components/AiCourseComposer.tsx` | 顶部入口 + 输入/粘贴截图 + 进度 + 待确认列表 + 编辑/删除/确认 |
| `renderer/components/SettingsPage.tsx` | 「AI 课程助手」设置块（模型、来源、设备、精度、步数） |

### 关键设计

1. **推理在 Worker 里**：`@browser-ai/transformers-js` 的 `TransformersJSWorkerHandler` 跑在
   独立 ES module worker 里（`worker.format = 'es'`，`?worker&url` 引入），主线程只做 UI。
2. **模型一次只认一个 tool call**：provider 的流式解析里是 `slice(0,1)`，所以主入口是
   `add_courses({courses:[…]})` 一次提交整张表；`add_course / update_course / remove_course /
   clear_courses` 用于单条增删改。看图时 `stepCountIs(1)`，因为多模态路径第二步只带最后一条
   工具结果、上下文已残缺。
3. **不能把模型输出直接入库**：所有字段都过 `draft.ts` 的归一化与兜底，缺信息的标「待确认」；
   用户点确认时才走原来的 `createCourse`，所以脏数据进不了数据库。
4. **双通道**：优先走原生 tool call；模型不出调用时，从回答里解析 ```tool_call 围栏 / JSON 数组，
   翻译成同样的工具调用。
5. **打包后用 `app://` 加载界面**（注册为 standard + secure）：file:// 下模块化 Worker、
   WASM fetch、WebGPU 安全上下文都会被拦。保留两重兜底：`did-fail-load` 与「8 秒内 #root
   没挂载」都会退回 file://（此时 AI 不可用，界面照常）。
6. **ORT wasm 本地化**：`onnxruntime-web` 是 transformers 的依赖、根目录不可见，vite 配置里
   从真实路径解析它的 dist，用 `@ort/*.wasm?url` 引成资源。注意必须用 **asyncify** 版本
   （`ort.webgpu.bundle.min.mjs` 内嵌工厂引的就是它），一开始引成 jsep 会多打包一份 28 MB 的
   错版本。
7. **精度降级**：`q4f16` 优先，仓库里没有对应组件文件时按 ladder 换 `q4`/`fp16`/`auto` 再试；
   只有「找不到文件」类错误才重试，断网/显存不足直接报错，不浪费时间。

### 测试

**新增 37 项（总数 480 项全部通过）**：

- 归一化 4 组：星期（数字/周X/星期X/英文）、节次范围、周次（含全学期与越界收敛）、单双周与时刻
- 草稿生成 6 项：中文键、按时间上课、缺信息标待确认、噪声丢弃、手动加行、摘要文案
- 工具归约 7 项：批量加入去重、驼峰名、按序号/按课名改、删除/清空、未知工具、参数取值
- 入库参数 2 项：能过课程校验、弹窗改完回填不丢字段
- 配置 5 项：默认值、非法值回退、镜像/自定义地址、精度顺序、重试判定
- 提示词与兜底 6 项
- 界面端到端 8 项：入口/展开、识别→待确认→确认入库、待确认标记、确认前编辑、删除草稿、
  引擎报错展示、没学期时禁用、请求带上作息表与周数

### 没法在本会话验证的部分（重要）

| 项目 | 情况 |
| --- | --- |
| 启动 Electron | 本会话里 GPU/GL 进程起不来（`gpu_process_host` / `GLES3 context` 失败），窗口无法渲染，和以前一样 |
| 真实模型推理 | 本机 hosts 把 `huggingface.co` 指到 127.0.0.1、且 TLS 被中间人拦截，模型下载不了；只能验证到「打包产物正确、逻辑与界面对」 |
| 需要真机确认 | ①窗口能打开（app:// 生效，控制台没有协议报错）②点「识别并填入」能看到下载进度 ③贴截图能出草稿 ④确认后课表出现课程 |

`dist/renderer` 已重新打包通过（`assets/` 里可见 worker 540 KB、engine 966 KB、
`ort-wasm-simd-threaded.asyncify.wasm` 26.9 MB 各一份）。

---

## 17. 第 16 轮：模型下载改走魔搭（ModelScope）+ 主进程下载代理

### 为什么改

用户反馈 HF 官方站与镜像站都不稳定。魔搭上有**同一个仓库**
（`onnx-community/Qwen3.5-2B-ONNX-OPT`，国内直连），但它的下载地址**不给浏览器跨域读**
（没有 `Access-Control-Allow-Origin`），渲染进程直接 fetch 拿不到内容，所以光改
`env.remoteHost` 是不够的。

### 做法

1. **来源预设**（`ai/config.ts`）：魔搭（默认）/ HF 官方 / hf-mirror / 自定义。
   魔搭的路径与 HF 不同，用 transformers.js 的 `env.remotePathTemplate` 解决：
   - 魔搭：`models/{model}/resolve/master/`
   - HF：`{model}/resolve/{revision}/`
   老设置里的 `official` / `mirror` 自动映射到新值，不用手动改。
2. **主进程下载代理**（`main/modelProxy.ts`）：`127.0.0.1` 上起一个小 HTTP 服务，
   按路由转发并补上跨域头（含 Chrome 私有网络预检的 `Access-Control-Allow-Private-Network`）：
   `/ms/* → modelscope.cn`、`/hf/* → huggingface.co`、`/mirror/* → hf-mirror.com`、
   `/custom/* → 用户填的地址`。响应流式管道转发，`content-length`/`range` 原样透传，
   HEAD/OPTIONS/404/502 都有处理；自定义地址不接受回环与内网 IP，避免变成内网跳板。
3. **端口固定**（47831–47833，被占用才随机）：浏览器缓存按 URL（含端口）存，
   端口一变 1.6 GB 就得重下。
4. **端口传递**：主进程把 `modelProxy=<port>` 拼进启动 URL，界面用 `readModelProxyBase`
   解析；没有这个参数（浏览器预览 / 测试）就直连上游站点。
5. **精度修正**：查仓库文件后发现三个组件都有 q4f16，于是首选改成
   `embed_tokens / decoder_model_merged / vision_encoder 全 q4f16`（约 1.6 GB，
   比原先把 vision_encoder 设成 fp16 少 0.5 GB）。仓库的 `config.json` 自带
   `transformers.js_config.use_external_data_format`，`.onnx_data` 分片会被
   transformers.js 自动加载，不需要额外传参。

### 测试（总数 498 项全部通过，新增 12 项）

- 代理：魔搭/HF/镜像路由、查询串不参与解析、越界与空字节被拒、自定义地址补协议头、
  回环与内网被拒、启动参数里的端口解析，以及**实际起一个假上游跑通转发**
  （内容/长度/跨域头/HEAD/404/OPTIONS）
- 配置：默认来源与路径模板、老值兼容、自定义地址的魔搭风格判定、
  有代理时按来源分路由、q4f16 首选组合

### 仍未验证

- 本机 TLS 走不通（`huggingface.co` 在 hosts 里指向 127.0.0.1），**真实下载没能实测**；
  魔搭的文件列表与 `config.json` 是通过外部抓取核对的（q4f16 三个组件都在，
  分片配置也齐全）。
- Electron 窗口在本会话仍然起不来，代理随程序启动这条需要真机确认：
  点「识别并填入」后应先看到「正在加载模型…%」，并且能在
  `设置 → AI 课程助手` 里切换来源后重试。

---

## 18. 第 17 轮：GPU 兼容自愈 + 日程 AI 入口 + AI 状态窗

### 1. 程序打不开：自动加 `--in-process-gpu`

现象（用户实测）：`pnpm start` 直接刷 `GPU process launch failed: error_code=18`，
接着 `FATAL:gpu_data_manager_impl_private.cc(423): GPU process isn't usable. Goodbye.`，
窗口一个都不出来。手动加 `--in-process-gpu` 就能正常打开。

做法（`main/gpuCompat.ts` + main.ts）：

- 启动开始时在 userData 写 `boot.pending`，窗口 `did-finish-load` 后删掉；
- 下次启动如果看到 `boot.pending`，说明上次没走完 → 自动 `appendSwitch('in-process-gpu')`；
- 用兼容模式成功启动后，把结论写进 `gpu-compat.json`（7 天后过期），期间一直走兼容模式；
  过期后再试一次正常 GPU，再崩就再进兼容模式，驱动修好后能自己回到硬件加速；
- `--in-process-gpu` 显式传参、或 `AI_SCHEDULE_GPU_COMPAT=1` 也可强制打开，且不会被覆盖；
- 兼容模式通过启动参数 `gpuCompat=1` 告诉界面，AI 状态窗里会说明"显卡加速可能不可用"。

另外引擎加了**设备降级**：WebGPU 起不来（驱动/上下文错误）时自动改用 WASM 重试，不再直接失败。

### 2. 日历页也有 AI 入口

之前只有课程表页有入口，用户反馈"新建日程没有 AI"。现在日历页头部也有「用 AI 记日程」，
说明也一栏：一句话或截图 → `add_events` / `update_event` / `remove_event` / `clear_events`
工具调用 → 待确认列表 → 用户检查/编辑（复用 EventDialog）→「全部加入日历」。

- `ai/eventDraft.ts`：日程草稿与字段归一化（绝对日期、今天/明天/后天、"M月D日"、全天/待办/
  只有开始/时间段、类别中英文），工具调用归约，草稿 ↔ `EventInput`/`EventItem`；
- `ai/eventTools.ts`：5 个工具 + 提示词（把今天的日期写进提示，强制输出 YYYY-MM-DD）+ 兜底清单；
- `components/AiEventComposer.tsx`：顶部入口、粘贴/拖拽截图、待确认列表、编辑/删除/确认。

为了两个入口共用一套引擎，做了这些重构：

- `ai/types.ts` 增加 `AiTaskSpec`（工具 + 系统提示 + 用户提示 + 兜底配置）、`DraftEvent`、`AiStatus`；
- 引擎不再认识"课程/日程"，只吃 `spec`；
- 提示词与工具定义留在纯逻辑层（`tools.ts` / `eventTools.ts`），引擎不依赖业务；
- 兜底 JSON 解析抽到 `ai/fallback.ts`，按任务给出"数组落到哪个工具/字段"。

### 3. 主界面 AI 状态窗

`ai/runtime.ts`（单例）+ `components/AiStatusBadge.tsx`：

- 状态窗固定在右下角，显示 **待命 / 下载中 xx% / 加载中 / 识别中 / 运行正常 / 出错 / 已关闭**；
- 点开能看到模型、来源、精度、实际设备，正在跑时可直接「停止」，还能一键跳到设置；
- 课程与日程两个入口共用同一个模型实例（只下载一次），切换页面不会打断下载/识别；
- 状态由 `AiRuntime` 统一维护，组件只订阅，避免两份状态打架。

### 4. 测试

**总数 539 项全部通过**（本轮新增 58 项）：

- 日程：时间解析（绝对/相对/不存在的日期）、类别与形态、草稿生成、工具归约、入库参数、提示词
- 运行时：加载→生成→就绪、报错、中止、关闭、配置变更释放引擎
- 状态窗：六种状态文案、展开详情、停止、GPU 兼容提示、主界面常驻
- 日程入口：端到端（识别→待确认→确认入库）、请求内容、草稿编辑
- GPU 兼容：判定矩阵（argv/env/上次崩溃/记住的结论/过期重试）与状态文件读写

### 5. 真机验证提示

- 第一次用新版本启动**可能还会崩一次**（程序要"看到一次失败"才会记住这台机器需要兼容模式），
  第二次启动就会自动带上 `--in-process-gpu`；急着用可以直接 `pnpm start -- --in-process-gpu`。
- 兼容模式下 Chromium 的 GPU 进程不独立，WebGPU 大概率不可用，AI 会自动改用 CPU（慢一些），
  状态窗里会写明"兼容模式"。

---

## 19. 第 18 轮：AI SDK v7 的 system 消息坑 + 启动日志说明

### 现象

真机上点「识别并填入」后界面报：

```
识别失败：Invalid prompt: System messages are not allowed in the prompt or messages
fields. Use the instructions option instead.
```

模型本身已经加载成功了 —— 这个错是 AI SDK v7 在**提示词校验**阶段抛的。

### 根因与修复

AI SDK v7 把系统提示从 `messages` 里拆了出去：`messages` 只允许 user / assistant / tool，
系统提示必须走 `instructions`（旧的 `system` 字段也还在，但官方推荐 `instructions`）。
我们之前把 system 消息塞进 `messages`，于是被
`standardizePrompt`（`ai/dist/index.js:2460`）直接拒掉。

改法（`ai/engine.ts`）：

```ts
streamText({
  model,
  instructions: request.spec.systemPrompt,   // ← 系统提示
  messages: [{ role: 'user', content: userContent }],
  ...
})
```

SDK 会把 `instructions` 还原成一条 system 消息交给 provider，所以 Qwen 的 chat template
照样能拿到它；看图那条路径本来就会被 provider 丢掉 system，规则已经写进用户消息里了。

顺手加了一条**契约测试**（`tests/unit/airuntime.test.ts`）：直接读 `engine.ts` 源码，
断言它用 `instructions:` 且不再出现 `role: 'system'`，防止以后又被改回去。

### 关于 `pnpm start > log.log` 里的"怪报错"

用户重定向出来的日志只有两类内容，都不是真故障：

| 日志内容 | 真相 |
| --- | --- |
| `pnpm.exe : $ electron .` + `NativeCommandError` | PowerShell 把原生命令的 stderr 包成了 ErrorRecord（用了 `2>&1` 就会这样），程序本身没问题 |
| `鍚敤 GPU 鍏煎鏍＄ǹ寮?-in-process-gpu...` | 是我打的中文警告在 GBK 控制台里被解码成了乱码；`--in-process-gpu` 是**自愈生效**了，`reason=state` 表示读到了上次记下的兼容结论 |

为避免以后再被乱码误导，这行警告改成了 ASCII 打头：
`[gpu-compat] enabled --in-process-gpu (reason=state) 已启用 GPU 兼容模式`。
想拿到干净日志可以用 `cmd /c "pnpm start > log.log 2>&1"`（绕开 PowerShell 的 stderr 包装）。

**测试总数 541 项，全部通过。**

---

## 20. 第 19 轮：WebGPU 只有软件适配器 + 不支持 f16 的兜底

### 现象

真机（兼容模式启动）点识别后报：

```
failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: Non-zero status code returned while
running GatherBlockQuantized node. Name:'/model/embed_tokens/Gather_Quant'
Status Message: shader_helper.cc:416 GenerateSourceCode Program GatherBlockQuantized
requires f16 but the device does not support it.
```

状态窗里还写着「设备：显卡加速」。

### 根因

`--in-process-gpu` 兼容模式下 `navigator.gpu` 是存在的，但 `requestAdapter()` 拿到的是
**软件适配器**（`isFallbackAdapter`），不支持 `shader-f16`。q4f16 是「4 位权重 + fp16 计算」，
WebGPU 执行器必须用到 f16，于是加载能过、**推理第一次 OrtRun 就炸**。
之前的兜底只覆盖「加载失败」，覆盖不到「加载成功但跑不动」。

### 修复（三层）

新增 `ai/gpu.ts`：

1. **事前探测**：`detectGpuSupport()` 读 `adapter.isFallbackAdapter` 与
   `adapter.features.has('shader-f16')`，`planExecution()` 给出执行计划：
   - 软件适配器 → 直接**用 CPU**（假 GPU 比 WASM 还慢），状态窗显示设备=CPU；
   - 真显卡但不支持 f16 → 留在显卡上、精度降到 **q4**（fp32 计算）；
   - 真显卡且支持 f16 → 照用户选的精度走。
2. **加载失败兜底**：显卡加载不起来时换 CPU 再试（原来就有）。
3. **推理失败兜底**：OrtRun / shader / device lost 这类错误且当前在显卡上 →
   丢掉这个 worker，换 CPU **重试一次**（`shouldRetryOnCpu`）。

界面同步：状态窗的「设备」现在会如实显示 CPU，兼容模式提示改成
「显卡多半用不了；AI 会先用 CPU 跑」。

### 测试

新增 9 项（`tests/unit/aigpu.test.ts`）：执行计划六种组合（含软件适配器、真显卡无 f16）、
以及「真机那条报错要退 CPU / 网络错误不该重试」。

**测试总数 550 项，全部通过。**

### 体验预期

这台机器最终会跑在 **CPU（WASM）** 上：能出结果，但比显卡慢很多（视觉编码器也要 CPU 跑）。
建议一次贴一张课表、文字描述尽量简短；如果嫌慢，可以在设置里把「运行设备」固定成纯 CPU，
省掉每次探测。

---

## 21. 第 20 轮：WASM 没有 GatherBlockQuantized + DevTools 打不开

### 现象 1

退到 CPU 后报：

```
Can't create a session. ERROR_CODE: 9, ERROR_MESSAGE: Could not find an implementation
for GatherBlockQuantized(1) node with name '/model/embed_tokens/Gather_Quant'
```

### 根因与修复

`GatherBlockQuantized` 是**块量化**的 gather，只有 GPU 执行器（WebGPU/CUDA）实现，
onnxruntime-web 的 **WASM 执行器完全没有**。而 q4f16 / q4 的 `embed_tokens` 正好是块量化权重。

修法（`ai/config.ts`）：`dtypeCandidates(kind, device)` 改成**按设备分梯子**：

- WebGPU：维持原来的（q4f16 → q4 → …）；
- WASM：`embed_tokens` 一律换成 **q8**（`_quantized`，588 MB，Graph 是
  Gather + DequantizeLinear，WASM 支持），decoder 仍可用 q4f16（`MatMulNBits` WASM 有实现），
  后面依次退到 fp16 / fp32 的 embed_tokens。

同时把「换精度重试」的判定扩到**会话创建类错误**：
`Could not find an implementation` / `Can't create a session` / `GatherBlockQuantized` /
`MatMulNBits` 现在都会让梯子往下走一格（以前只认「文件找不到」）。

### 现象 2：`Ctrl+Shift+I` 没反应

菜单里本来就有「视图 → 开发者工具」（`CmdOrCtrl+Shift+I`）。但这台机器挂着
**GameViewer 虚拟显示器 / 远程串流**，这类客户端经常把组合键吞掉。

修法：
- 主进程直接监听 `before-input-event`，**F12** 或 `Ctrl+Shift+I` 都能开/关 DevTools；
- 菜单里再补一条带 `F12` 加速键的「开发者工具（F12）」。

### 顺带看清的硬件情况

`Win32_VideoController` 有 **NVIDIA RTX 5060 Laptop** 与 **Intel Graphics**，但也有一块
**GameViewer Virtual Display Adapter** —— 说明当前是远程串流会话。虚拟显示适配器 + 串流会话下，
Chromium 的 GPU 子进程起不来（`error_code=18`），`--in-process-gpu` 也只能拿到 SwiftShader 软件适配器。
**在本机屏幕前直接启动**（或在显卡控制面板里把 electron.exe 指定为独显）才能用上真显卡。

### 测试

新增 4 项（WASM 梯子不许出现块量化 embed_tokens、会话缺算子算重试理由等）。**总数 553 项全部通过。**

---

## 22. 第 21 轮：恢复硬件加速——兼容模式改成三级阶梯（先 `--disable-gpu-sandbox`）

### 用户反馈

"我一直都是在本机屏幕前直接启动程序的，从来没在 GameViewer 里操作过。"

### 结论：虚拟显示驱动是常驻的，和"用不用串流"无关

`Win32_VideoController` 里同时存在 `NVIDIA RTX 5060 Laptop`、`Intel Graphics` 和
`GameViewer Virtual Display Adapter`，说明系统里装了**虚拟显示适配器驱动**（IDD）。
这类驱动即使不在串流会话中也会常驻，Chromium 在枚举适配器 / 建共享上下文时会踩到它，
于是 `GPU process launch failed: error_code=18` → 判定 GPU 不可用 → 退到 SwiftShader。

社区里同一条报错的公认解法不是 `--in-process-gpu`（它把 GPU 线程搬进主进程、容易丢硬件加速），
而是 **`--disable-gpu-sandbox`**：
- StackOverflow:「GPU process isn't usable. Goodbye.」→ *Using `--disable-gpu-sandbox` flag with electron apps solved it for me*
- electron/electron#36698：同一条 `error_code=18`，`--no-sandbox` 也能绕过

### 改法：兼容模式分级 + 逐级自愈

`shared/gpuCompat.ts` 定义阶梯，`main/gpuCompat.ts` 负责判定与状态文件：

| 级别 | 追加开关 | 说明 |
| --- | --- | --- |
| `gpu-sandbox` | `--disable-gpu-sandbox` | **首选**：保留硬件加速 |
| `in-process` | `--disable-gpu-sandbox --in-process-gpu` | 硬件加速多半没了 |
| `software` | `--disable-gpu --disable-gpu-sandbox --disable-gpu-compositing` | 保底能开窗口 |

- 崩一次 → 自动降一级（`boot.pending` 记录"这次用的是哪级"）；
- 用某一级跑起来后记进 `gpu-compat.json`，7 天后自动再试正常 GPU；
- 老版本存的是布尔值（当时只试过 in-process）→ 升级后**先回到 `gpu-sandbox` 重试**，
  不行再降回 in-process，最多多崩一次；
- 状态窗会显示当前级别对应的说明（"已关闭 GPU 进程沙箱，显卡仍可用"等）。

### 用户那边现在怎么验

1. `pnpm start -- --disable-gpu-sandbox` 直接试这一级；
2. 窗口出来后按 **F12**，控制台跑
   `const a = await navigator.gpu.requestAdapter(); a && { fallback: a.isFallbackAdapter, features: [...a.features] }`；
   `fallback: false` 且有 `shader-f16` 就是真显卡回来了；
3. 想更彻底：设备管理器里临时**禁用** `GameViewer Virtual Display Adapter`（以及别的 IDD 虚拟显示器），
   再正常启动（不带任何参数）。

**测试总数 557 项，全部通过**（新增 4 项：阶梯降级、开关内容、老状态兼容）。

---

## 23. 第 22 轮：删掉本地推理，改用硅基流动的 Qwen3.5-4B

### 为什么删

本地推理这条链路在这台机器上始终跑不通（不是代码问题，是环境问题，见第 20/21/22 节）：

- Chromium 的 GPU 子进程起不来（虚拟显示驱动导致 `error_code=18`）；
- 退到 WebGPU 只拿到 SwiftShader 软件适配器，不支持 `shader-f16`，q4f16 的 kernel 编不出来；
- 再退到 WASM，`embed_tokens` 的 `GatherBlockQuantized` 在 onnxruntime-web 的 CPU 执行器里没有实现。

用户决定放弃本地推理，改用**硅基流动**的 `Qwen/Qwen3.5-4B`（免费额度）。

### 新的调用链

```
渲染进程（AI 面板 / 状态窗）
  ↓ window.api.aiChat(payload, onChunk)      ← preload 桥
主进程 ai:chat（ipcMain.handle）
  ↓ fetch(https://api.siliconflow.cn/v1/chat/completions, stream: true)
SSE 分片 → 按请求 id 推回（ai:chunk）
```

- 为什么由主进程发：渲染进程的 origin 是自定义的 `app://`，直连第三方接口会被 CORS 挡；
- 不用任何 SDK：OpenAI 兼容协议 + 手写 SSE 解析（`main/aiClient.ts`），顺带支持 abort；
- API Key 两种来源：设置页填写（存本机数据库），或主进程环境变量 `SILICONFLOW_API_KEY`。

### 代码变化

| 删掉 | 说明 |
| --- | --- |
| `renderer/ai/courseAiWorker.ts` | Web Worker 推理 |
| `renderer/ai/gpu.ts` | 显卡/精度探测 |
| `main/modelProxy.ts` | 魔搭/HF 模型下载代理 |
| `ai/config.ts` 里的 dtype 梯度、来源、精度 | 不再需要 |
| 依赖：`@huggingface/transformers`、`@browser-ai/transformers-js`、`ai`、`@ai-sdk/react` | 打包体积大幅下降 |

| 新增/改写 | 说明 |
| --- | --- |
| `shared/aiChat.ts` | OpenAI 兼容的消息/工具/分片类型 |
| `main/aiClient.ts` | 流式 chat 客户端（SSE 解析 + 工具调用增量拼接） |
| `renderer/ai/engine.ts` | 云端引擎：一次请求 → 工具调用 → 再补一轮"无工具"总结 |
| `preload` + `shared/ipc` | `aiChat(payload, onChunk)` / `aiCancel(id)` |

保留不变：任务描述（提示词 + 工具 JSON Schema）、草稿归约、`AiRuntime` 状态机、
两个入口（课程表 / 日历）、右下角状态窗、兜底 JSON 解析。

细节：

- 工具调用走标准 OpenAI `tools` + `tool_choice: auto`，参数从 `delta.tool_calls` 增量拼；
- 有工具调用时再发一轮不带 tools 的请求，让模型用一句话收尾（失败忽略）；
- 没有工具调用时，退回"从回答里解析 ```tool_call / JSON 数组"的老路；
- 带图片被 400 拒绝（文本模型）时，自动去掉图片重试，并提示"图片没有发出去"；
- 状态窗改成：待命 / 连接中 / 生成中 / 运行正常 / 出错 / 已关闭，展开可看模型、接口、Key 打码。

### 测试与构建

- **534 项测试全部通过**（删掉了本地推理相关的 19 项，重写了 AI 配置/运行期/状态窗三组）；
- 渲染产物从 `engine 966 KB + worker 540 KB + wasm 26.9 MB` 降到 **`index 350 KB + engine 3.6 KB`**；
- 主进程新增 `dist/main/aiClient.js`，`dist/main/modelProxy.js` 已删除。

### 未验证

- 真实 API 调用：本机 TLS 出不去（`huggingface.co` 在 hosts 里指向 127.0.0.1，外网证书被拦），
  也没有用户的 Key，所以只能验证到"请求构造、SSE 解析、状态流转"这一层；
- 需要用户在设置里填 Key 后，真机点一次「识别并填入」确认。

---

## 24. 第 23 轮：云端调用"卡住"的三个原因与修复

真机现象：点了「识别并填入」后，状态一直停在「正在请求 Qwen/Qwen3.5-4B…」，没有报错也没有结果。

### 修了三处

1. **`data: [DONE]` 没有真正结束**（真 bug）
   `aiClient.ts` 里原来遇到 `[DONE]` 只是 `continue`，继续等连接自己关闭。
   有些服务端 / 代理发完 `[DONE]` 后不马上断流，于是 promise 永远不返回 —— 界面就卡在"请求中"。
   改成收到 `[DONE]` 立刻 `break`，跳出读流的循环。

2. **纯工具调用时没有任何可见反馈**（体验问题）
   `Qwen3.5-4B` 在工具调用模式下不吐正文（`delta.content` 是空的，只有 `delta.tool_calls`），
   所以从点下按钮到结果落地之间界面完全静止，看起来像死机。
   现在主进程**每秒发一次心跳**（`{type:'heartbeat', elapsedMs, toolCalls}`），
   界面显示「模型正在生成…（已 12 秒）」/「模型正在整理字段…（已 20 秒，收到 3 组工具调用）」。

3. **没有区分"网络不通"和"模型慢"**
   新增**首字节超时 20 秒**：20 秒内一个字节都没收到就中止，并明确报
   「接口 20 秒没有响应：检查网络能否访问 https://api.siliconflow.cn/v1，或 API Key 是否可用」。
   整体仍保留 120 秒上限。

### 另外加了「测试连接」

设置 → AI 助手（云端）→ **测试连接**：用当前模型发一句「只回复两个字：收到」（`max_tokens: 16`，30 秒超时），
直接把结果用提示条报出来（连接正常 / 401 / 429 / 超时）。排查 Key 和网络不用再去点识别。

### 测试与构建

- 新增 4 项 SSE 解析测试（`\r\n`、注释行、多行 data、缓冲区残留），**总数 538 项全部通过**；
- 主进程 `aiClient.js` 6557 字节，renderer 仍是 350 KB + 3.8 KB，没有本地推理残留。

### 真机上现在应该看到的

- 网络 / Key 有问题 → 20 秒内出现明确错误；
- 模型在正常生成 → 状态栏每秒刷新「已 N 秒」；
- 出结果 → 待确认列表出现条目、状态窗变成「运行正常」。

---

## 25. 第 24 轮：超时拆分 + 只发文字开关 + 独立的接口探针脚本

真机现象：点「识别并填入」等一阵后报「请求超时，请检查网络或稍后重试」（这是**整体 120 秒**超时那条），
说明请求已经连上但**一直没有有效内容返回**。光看界面分不清是"网络被卡""Key 有问题"还是"模型在排队"，
所以这轮做了三件事。

### 1. 超时拆成三段，报错更具体

`main/aiClient.ts`：

| 判定 | 时长 | 提示 |
| --- | --- | --- |
| 首字节超时 | 20 秒 | 「接口 20 秒没有响应：检查网络能否访问 …，或 API Key 是否可用」 |
| **空闲超时（新增）** | 连续 30 秒没有新内容 | 「接口连续 30 秒没有返回新内容，已中止：可能是模型排队太久或网络中途断开」 |
| 整体超时 | 120 秒 | 「请求超时，请检查网络或稍后重试」 |

另外主进程会往控制台打日志（`log.log` 里能看到）：
`[ai] chat start model=… image=yes tools=5` / `[ai] chat done text=… toolCalls=…` / `[ai] chat failed: …`。

### 2. AI 面板加「只发文字」勾选

截图这件事本身可能是元凶（文本模型收到 `image_url` 后会长时间不返回或直接卡住）。
课程表页的 AI 面板现在有「**只发文字**」勾选框，勾上就只发文字、不带图片，方便二分定位。

### 3. 独立探针脚本 `scripts/ai-probe.py`

不用开程序，直接用 Python（只用标准库）逐段验证：

```powershell
python scripts/ai-probe.py --key sk-xxxx
```

它按顺序打印：DNS → TCP/TLS（含**证书颁发者**，能看出是否有中间人代理）→ `/models`（验 Key）→
普通对话 → 工具调用 → 流式 SSE（打印首个数据包耗时）→ 可选图片测试（`--image 路径`）。
证书报错时可以加 `--insecure` 先确认服务本身是否可用。

### 4. 其它

- 按用户要求，右下角状态窗**去掉了 GPU 兼容模式那段提示**（自愈机制保留，只是不再显示）；
- 顺带把两份 composer 里已经没意义的 "首次下载模型" 文案换成了当前模型 + Key 状态。

**测试 538 项全部通过，主进程与前端重新打包。**

---

## 26. 第 25 轮：流式"只有思考没有正文"的定位（探针升级 + 关思考）

用户质疑得很准：非流式 10 秒就出结果，流式 30 秒却 0 正文，二者矛盾。
复查后发现两次测试**不可比**：非流式那条 `max_tokens=16`（很多服务端只把可见正文计入
max_tokens，思考 token 不计数），流式那条是 64，而且提示词不同——思考长度本来就随提示词变。

### 探针升级（`scripts/ai-probe.py`）

- 第 6 步现在打印：HTTP 头（content-type / transfer-encoding）、前 3 个 `data:` 原始负载、
  行数与 data 事件数、空 delta 数，并**分开统计**正文 / `reasoning_content` / 工具调用；
- 新增 `--thinking` 开关（默认关），第 4/5/6 步都会带上
  `enable_thinking` + `chat_template_kwargs.enable_thinking`；
- 流式预算默认 45 秒，非流式 30 秒，工具调用 60 秒。

### 程序侧的对应改动

- `main/aiClient.ts`：请求体固定带 `enable_thinking: false` 与
  `chat_template_kwargs: { enable_thinking: false }`；把 `reasoning_content` 单独计数，
  不进正文；空闲超时放到 45 秒、整体 180 秒（`max_tokens` 设 4096 防跑飞）；
- `renderer/ai/engine.ts` 心跳文案区分三态：
  「模型正在思考…（已 N 秒，思考 X 字）」/「模型正在生成…」/「模型正在整理字段…」；
- 右下角状态窗不再显示 GPU 兼容提示（用户要求）。

**测试 538 项全部通过。**

---

## 27. 第 26 轮：探针复测确认"深度思考"是唯一原因

同一台机器、同一个 Key，关掉思考后重跑探针：

| 步骤 | 关思考（本轮） | 开思考（上一轮） |
| --- | --- | --- |
| 普通对话 | 0.59s → “收到” | 10.07s |
| 工具调用 | 1.43s，返回 `add_courses` | 8.68s |
| 流式 | **1.63s，正文 80 字，首包 0.42s** | 30s 内 1469 行、正文 0 字 |
| 图片 | 9.14s，正确读出“周课程表” | 未测 |

结论：

1. 之前的 120 秒超时确实是**模型默认深度思考**（先吐 `reasoning_content`，正文迟迟不来）导致；
   上一轮"非流式 10 秒就出结果"不可比——那条 `max_tokens=16`，且提示词不同。
2. **`Qwen3.5-4B` 在硅基流动上是支持图片的**（能读课表结构），所以"只发文字"只是排查用的开关，
   平时不用勾。

### 程序侧最终形态

- 请求固定 `enable_thinking: false` + `chat_template_kwargs.enable_thinking = false`；
- `reasoning_content` 单独计数（不进正文），心跳据此显示「模型正在思考…（已 N 秒，思考 X 字）」；
- 超时收成一条**空闲超时 45 秒**（首字节迟迟不来也算空闲，避免图片请求被 20 秒误杀），整体 180 秒；
- `max_tokens: 4096` 防跑飞；`data: [DONE]` 立即结束读流；
- 主进程日志：`[ai] chat start/done/failed`，直接看 `log.log` 就能定位。

**测试 538 项全部通过，主进程与前端已重新打包。**

---

## 28. 第 27 轮：AI 重复添加已有课程

现象：课程表里已经有部分课程时，再让 AI 识别一次，会把同一门课再加一遍，同一时段出现两节一样的课。

原因有两层，都补上了：

### 1. 模型不知道课表里已经有什么（提示词缺上下文）

之前只把「编辑界面里待确认的草稿」给了模型，没给**已经入库的课程**，所以它按截图逐条加。

- `CoursePromptOptions` 新增 `existing`，`buildUserPrompt` 里输出一段
  「课表里【已经存在】的课程（这些不要再加一遍，只有用户明确要求时才用 update_course 改）」，
  每行格式与草稿列表一致（星期 + 课名 + 时段 + 周次）；
- 系统提示新增第 9 条规则，明确"星期与节次都对得上就跳过"；图片那条紧凑规则里也加了同样一句；
- 面板把 `existingCourses`（App 的 `courses`）传进 `buildCourseTask`。

### 2. 入库前没有兜底去重（模型仍可能重复）

- `ai/draft.ts` 新增一组纯函数：
  - `normalizeCourseTitle()`：去空白、全角括号转半角、转小写；
  - `weeksOverlap()`：周次范围相交 + 单双周判定（一单一双永远不会重合）；
  - `findExistingCourse(draft, existing, periods)`：**同名 + 同星期 + 同时段 + 周次有重叠**才算重复；
    `period` 与 `clock` 两种排课方式先统一换算成起止时间再比；
  - `splitDuplicates()`：同时去掉"与已有课程重复"和"这一批自己重复"的。
- 面板行为：
  - 重复的行灰显并标「**已存在**」，列表标题显示「其中 N 门课表里已有」；
  - 点「全部加入课程表」时自动跳过重复项，提示「已加入课程表：X 门（跳过 N 门重复的）」；
  - 全都重复时不写库，直接提示「这些课程课表里都已经有了，不需要重复添加」。

### 测试

- 新增 `tests/unit/aicourseDuplicate.test.ts`（9 项）：归一化、单双周重叠、时段不同不算重复、
  周次错开不算重复、clock 与 period 混排、批内重复；
- `tests/ui/aicomposer.test.tsx` 加 3 项：请求里带上已有课程清单与"不要再加一遍"规则、
  重复行被标记且确认时跳过、全都重复时不写库；
- **总数 550 项全部通过**，主进程与前端已重新打包。

---

## 29. 第 28 轮：提示词里加上"现在时间"

用户要求：系统提示词里给出当前时间。

之前课程那套提示词完全没有时间概念（只有总周数），模型没法判断"这周还剩哪些课""下周开始算第几周"；
日程那套只有 `今天是 2026-10-18`，没有星期也没有时刻，"明晚八点""周五下午"这种说法就容易算错。

### 改法

- 新增 `renderer/ai/nowText.ts`：`formatNowText(now, semesterStartDate?)`
  → `2026-10-18（周日）14:32，当前是第 6 周（双周）`
  （周次用 `semesterWeekIndex` 算，学期还没开始时就不写周次）；
- `CoursePromptContext` 增加 `now` / `semesterStartDate`，`buildSystemPrompt` 里输出
  `【现在时间】…`，并新增第 10 条规则：「今天/明天/这周/下周」以【现在时间】为准；
- 图片那条紧凑规则（`compactRules`）也带上【现在时间】；
- 日程侧 `EventDraftContext` 增加 `now`，系统提示与图片规则都改成
  「【现在时间】…，今天是 2026-10-18」，相对日期仍然要求输出绝对日期；
- 两个 composer 各加一个 `courseContext()` / `eventContext()` 辅助函数，
  调用时取 `new Date()`（日程用组件传入的 `today`，测试可控）。

### 测试

新增 `tests/unit/ainow.test.ts`（7 项）：格式、周次与单双周、学期未开始、
课程系统提示、图片紧凑规则、日程系统提示、显式传入的 now 优先。

**总数 557 项全部通过**，主进程与前端已重新打包。

---

## 30. 第 29 轮：换成 DeepSeek V4.1 Flash，并打开深度思考

用户反馈 Qwen3.5-4B 识别质量太差（4B 小模型读课程表确实吃力），要求换成 DeepSeek 官方的
V4.1 Flash，并把思考打开。

### 改动

- `DEFAULT_MODEL` 改为 `deepseek-ai/DeepSeek-V4.1-Flash`，模型预设里加上
  `deepseek-ai/DeepSeek-V3.2` 与原来的 Qwen 作为备选；
- 新增设置项「**开启深度思考**」（`ai.thinking`，默认开）；
  - `AiRuntimeConfig` 增加 `thinking`，`engine` 里按 `enableThinking: config.thinking` 传下去；
  - 思考模式下 `max_tokens` 放宽到 8192（推理过程也吃额度，4096 会被截断）；
  - `main/aiClient.ts` 同时带 `enable_thinking` 与 `chat_template_kwargs.{enable_thinking,thinking}`，
    vLLM 系不同实现都认；
- 状态窗多显示一行「思考 开/关」，面板心跳仍区分「正在思考…（思考 X 字）」/「正在生成…」；
- 模型名写错时（接口回 `Model does not exist` 之类）错误信息会自动补一句
  「到设置里改模型，或跑 `python scripts/ai-probe.py --list deepseek` 看可用 id」；
- 探针新增 `--list <关键词>`：只列模型 id（不跑对话），用来核对硅基流动上的真实模型名。

### 测试

- 配置测试改成断言默认模型是 `deepseek-ai/DeepSeek-V4.1-Flash` 且 `thinking` 默认 true；
- 状态窗测试断言展开卡片里有模型名与「思考」；
- **557 项全部通过**，主进程与前端已重新打包。

---

## 31. 第 30 轮：改用 DeepSeek 官方接口（https://api.deepseek.com）

用户澄清：不是硅基流动上的 DeepSeek，而是用 **DeepSeek 官方 API**。

### 官方接口和第三方网关的三个差别（都处理了）

1. **地址**：`DEFAULT_BASE_URL = 'https://api.deepseek.com'`，模型默认 `deepseek-chat`。
2. **思考不是参数而是模型**：官方没有 `enable_thinking`，思考模型是 `deepseek-reasoner`；
   所以 `config.ts` 新增 `isDeepSeekOfficial()` 与 `resolveEffectiveModel()`：
   官方地址 + 开启思考 + 模型不是 reasoner → 实际请求换成 `deepseek-reasoner`，
   面板/设置里会显示「deepseek-chat → deepseek-reasoner」并说明原因；
   第三方网关仍然沿用 `enable_thinking` 参数、模型名不动。
3. **字段严格**：官方接口不接受额外字段，`main/aiClient.ts` 里对官方地址**不再发送**
   `enable_thinking` / `chat_template_kwargs`，避免 400。

### 顺带加了「读取可用模型」

- 主进程新增 `ai:models`（`GET {base}/models`），preload 暴露 `aiModels()`；
- 设置页多一个「**读取可用模型**」按钮，把 Key 能用的模型 id 列成可点的按钮，点一下就写进设置；
- 这样以后换模型（包括官方将来新增的 flash 系列）不用猜 id。

### 其它

- 环境变量回退支持 `DEEPSEEK_API_KEY`（也兼容原来的 `SILICONFLOW_API_KEY`）；
- 探针默认地址/模型改成官方，`thinking_flags()` 对官方地址返回空（不发多余字段）；
- 使用说明改为 platform.deepseek.com 领 Key、默认 `deepseek-chat`、思考=reasoner。

### 测试

新增 `tests/unit/aideepseek.test.ts`（4 项）：默认地址与模型、域名识别（含 `/v1`、`api.` 前缀、
不会误判 `notdeepseek.com`）、开思考时 chat→reasoner 且第三方不动、关思考还原。
**总数 561 项全部通过**，主进程与前端已重新打包。

---

## 32. 第 31 轮：让 AI 能设置日程的重复规则

用户指出：AI 只能记单次日程，没法设「每周一三五」这种重复。

之前提示词里写着「重复日程先按单次记录，用户在弹窗里再改」——等于把这件事推给用户，
但模型本来就拿到了这句话，只是**工具里没有 repeat 字段**，想写也写不了。

### 数据层

- `DraftEvent` 新增 `repeat: DraftRepeat | null`，结构与库里的 `RecurRule` 同构
  （freq / intervalValue / intervalUnit / byWeekdays / untilDate / maxCount）；
- `eventDraft.ts` 新增：
  - `normalizeWeekdayList()`：认 `[1,3,5]`、「周一、三、五」、「周一到周五」、「1,3」；
  - `normalizeRepeatFreq()`：认 daily/weekly/biweekly/monthly/yearly/custom 与中文说法；
  - `normalizeRepeat()`：**对象或字符串**都能读（模型给对象，兜底时可能是「每两周」这种短语，
    字符串里还能解析「共 N 次」「到 YYYY-MM-DD」「每 10 天」）；
  - `describeRepeat()`：`每周 · 周一、周三 · 到 2026-12-31 · 共 10 次`；
  - `repeatProblems()`：星期越界、次数非正、截止日期格式错都会拦住；
  - `readEventFields` 增加 repeat 与 `repeatProvided`，用来区分「没提」和「明确取消」。

### 工具与提示词

- `EVENT_ITEM_SCHEMA` 新增 `repeat` 对象（含 freq/byWeekdays/untilDate/maxCount/intervalValue/intervalUnit），
  `add_events` / `add_event` / `update_event` 都能带；
- 系统提示第 7 条换成明确的映射表：每周一三五 → `{"freq":"weekly","byWeekdays":[1,3,5]}`、
  每两周 → biweekly、每天 → daily、每 10 天 → custom+interval、到期末 → untilDate、共 N 次 → maxCount；
  图片那条紧凑规则也加了一句；
- `update_event` 不给 repeat 就保留原规则，给 `null` 表示取消重复。

### 界面与入库

- 待确认列表里重复规则显示成标签（`每周 · 周四 · 到 2026-06-30`，样式 `.ai-composer__tag--repeat`）；
- 弹窗编辑时把已有规则带回去（频次/截止/次数可改，星期与自定义间隔原样保留，不会丢）；
- 确认入库改成分两步：有 repeat 就先 `createRecurrence()` 拿到 id，再 `createEvent({...input, recurrenceId})`，
  与手动新建重复日程走同一条路径；同时刷新重复规则列表。

### 测试

- 新增 `tests/unit/aieventRepeat.test.ts`（10 项）：星期解析、对象/字符串写法、自定义间隔、
  无周期含义返回 null、描述文字、工具调用落库、update 保留/清空、非法规则的拦截；
- `tests/ui/aiassistant.test.tsx` 加 1 项端到端：AI 给出 repeat → 列表显示 → 确认时
  `createRecurrence:weekly:4` 先执行、再 `createEvent:组会`；
- 弹窗重复规则断言同步更新（现在会把 byWeekdays/interval 原样带回）。
- **总数 572 项全部通过**，主进程与前端已重新打包。
