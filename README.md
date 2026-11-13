# DSH Quick Session

为 DeepSeek Harness 增加「无项目」新建入口。**不是纯聊天模式**：仍是普通 Agent 会话，有原生工具、模型和预设选择、历史记录及权限机制，只是不绑定 Workspace / 项目。

当前版本 `0.1.0`，针对 **DSH `0.2.2-rc.3`**。这是首版实现；安装后的界面和真实会话行为仍需要在当前 profile 验证。

## 使用方式

安装启用后，展开侧栏，点击原生新建按钮旁的 **「无项目」**。**Windows 桌面标题栏模式必须先展开侧栏**；首版在该模式的折叠状态隐藏插件按钮，避免与原生标题栏菜单碰撞。在其他模式的折叠侧栏中，按钮显示为会话加号图标，可悬停查看说明。

插件会：

1. 创建独立、持久的工作目录。
2. 调用原生 `sessionController.create({ cwd })`，**不传 `workspaceId`**，也不注册隐藏项目。
3. 打开原生会话界面。首次提示前，仍使用原生入口选择预设和模型。

按钮重复点击会被阻止；同一创建请求在当前插件实例的最近 128 条请求缓存内会复用结果，并非跨重启的事务保证。网络中断时，Host 可能已经创建成功，请先检查原生历史，不要盲目重复创建。插件不会自动发送提示词。

## 文件保存在哪里

默认根目录是用户主目录下的 `Documents/DSH/QuickSessions`，与当前选中的项目、插件源码目录无关。例如：

```text
C:\Users\Niannya\Documents\DSH\QuickSessions\2026-11-13\<request-uuid>\
```

日期取 Host 的本地日期；UUID 对每次请求唯一，并非原生 Session ID。会话的真实 `cwd` 由原生会话系统保存，插件不维护第二套会话数据库。

安装后可在插件配置里设置 `directoryRoot`：必须是绝对路径；空字符串使用默认值。修改根目录只影响之后新建的对话，既有会话继续使用原来的目录。根路径会规范化为真实路径；日期目录拒绝符号链接。不要选择由不可信第三方可写的共享根目录。

**归档会话、禁用、卸载插件都不会删除文件，也不会迁移目录。** 创建失败或中途取消可能留下空目录，同样不会自动清理。当前版本没有添加回项目、目录回收、`work` / `outputs` 分区等功能。

## 权限边界

- 侧栏操作走独立 Connection RPC，验证调用者为 Host 拥有者；远程访客即使获准原生 `session/create`，也不能调用此插件的创建操作。
- 新会话按原生新建流程使用部署默认值和预设规则。插件不申请提权，不修改 permission preset，不登记额外可写根目录，也不复制调用者的会话权限覆盖。
- Agent 工具 `create_quick_session` 复用同一个 Host 创建操作，只返回 Session ID 和 `cwd`，不打开页面、不发送消息。可选 `agent_preset` 默认沿用调用 Agent 的预设，否则使用原生默认。
- Node 的目录创建不能代替 DSH 的受限文件后端。因此 Agent 工具只允许调用者**已经是 `danger-full-access`** 时执行；`read-only`、`workspace-write` 或缺失权限一律在写文件前拒绝，不提供提权参数。受限 Agent 用户仍可自己点击侧栏按钮。
- 会话里其他工具继续由 DSH 原有权限和审批机制约束；本插件没有把工作目录称为「沙箱」。

## 开发与验证

不需要单独 Vite 服务，不打包 React；Client 使用 Host 提供的 React 和原生 Slot。Host 的 Schema 与 Tool 定义依赖当前 DSH 提供的包，没有安装脚本。

```powershell
pnpm test
pnpm run check
pnpm pack --pack-destination dist
```

这些命令应使用 DSH 捆绑的 Node 和 pnpm。当前开发环境可以直接执行测试，无需另装一套 Harness。真实文件测试只在仓库的 `.test-output` 下创建唯一目录，不删除测试文件；该目录已忽略。

入口与实现：

- [Host 入口与配置](./index.js)、[Host RPC 与 Agent 工具](./host.js)、[目录及会话创建逻辑](./core.js)。
- [Client 侧栏入口](./client.js)，使用 `sidebar.session.action` HOC，保留原生 children 一次，样式只使用 DSH 主题 token。
- [包清单](./package.json)、[Cordis patch](./cordis.patch.yml)、[中文元数据](./locale/zh.json)、[英文元数据](./locale/en.json)、[原创图标](./icon.svg)。
- [自动化测试](./tests/core.test.js)覆盖参数、独立目录、去重、取消、失败、权限、RPC 身份和卸载。

自动化测试不等于安装验证。还需要安装后确认：按钮在展开/折叠侧栏及深浅主题下显示正常；新对话没有项目关联；原生工具能在新 `cwd` 工作；预设、模型与历史正常；归档/禁用不清理文件。

## 安装与分发状态

源码和打包产物由开发者准备；**尚未安装到当前 profile**。在明确确认前，不修改 DSH profile，不自动 commit 或 push GitHub。

当前包标记为 `private` / `UNLICENSED`，防止误发布；这不妨碍本地安装。公开发布与许可证选择留待仓库所有者决定。本地检查时，pnpm 自动补装了 peer 开发依赖并生成 [锁文件](./pnpm-lock.yaml)；这不是安装插件或修改 DSH profile。[本地 pnpm 配置](./pnpm-workspace.yaml)移除了自动生成的依赖年龄豁免，并设置严格检查，避免以后自动绕过该检查。
