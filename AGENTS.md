# zashboard 协作说明

## 项目定位

这是一个 Vue 3 + TypeScript + Vite 的 Clash/sing-box 管理面板。当前维护分支是
`singbox-tools`，基于上游 `git@github.com:Zephyruso/zashboard.git`，保留了上游在
`4adb4872d90c8ec1b8bfab4b43308cdb2da12c3e` 删除的 sing-box 功能。

必须保留以下功能：

- sing-box 原生 gRPC API；
- Tailscale 面板、节点状态、退出节点和 SSH；
- Taildrop 文件收发；
- Web Terminal；
- USB/IP、OpenVPN 等 sing-box 工具。

不要因为上游 `main` 删除了这些文件，就把它们当作无用代码删除。

## 代码结构

- `src/api/`：后端协议请求层。视图层不要直接调用这里的后端 API。
- `src/assembly/`：业务组装层和后端门面。通过 `can()` 读取能力，通过 `Channel` 按
  `activeBackend.type` 路由 Clash REST/WS 或 sing-box gRPC。
- `src/components/`、`src/views/`、`src/composables/`：界面和交互层。
- `src/api/singbox/`：gRPC-Web、常驻 WebSocket 流和订阅重连逻辑。
- `src/assembly/*/singbox.ts`：sing-box 的代理、连接、日志、概览和规则适配器。
- `src/components/tools/`：Network Tools、Tailscale、Taildrop、Terminal 等页面。
- `src/gen/daemon/started_service_pb.ts`：由 `vendor/sing-box/daemon/started_service.proto`
  生成，修改 proto 后运行 `pnpm generate`。

公共 UI 不应直接判断后端类型或调用 sing-box API；新增后端差异时，优先扩展对应
assembly 门面和能力表。`ConnectionAccessor` 的 Clash 与 sing-box 实现必须同时满足
接口，包括 `isDirect`、协议、出站类型等字段。

## 开发环境

项目提供 `flake.nix` 和 `.envrc`，推荐：

```bash
direnv allow
```

也可以手动进入：

```bash
nix develop
```

环境包含 Node.js 22、pnpm、Git 和 direnv。首次准备依赖后运行：

```bash
pnpm install
pnpm generate
pnpm type-check
pnpm build
```

格式化命令会修改文件；执行前确认工作区状态。`pnpm lint` 使用 `--fix`，除非确实
需要，否则不要把无关的自动修复混入功能提交。

## 上游同步

`singbox-tools` 不是简单地从当前 `upstream/main` rebase 出来的：它跳过了删除
sing-box 的提交，并重放了该提交之后的上游提交。因此不要直接执行：

```bash
git rebase upstream/main
```

同步流程是把“上次同步的上游提交”之后的新提交 cherry-pick 到当前分支：

```bash
git switch singbox-tools
git fetch upstream
git cherry-pick <上次同步的上游提交>..upstream/main
```

当前已同步到上游提交 `b31d05f`（v3.26.0）。发生冲突时：

1. 保留上游对公共 UI、性能和数据结构的更新；
2. 保留 sing-box/Tailscale/Terminal 的适配器、工具组件、protobuf 和依赖；
3. 合并 `package.json` 与 `pnpm-lock.yaml`，不要整文件覆盖；
4. 对 `ConnectionAccessor`、`assembly/backend.ts`、`store/setup.ts` 等共享文件做语义合并；
5. 解决后执行 `git diff --check`、`pnpm type-check` 和 `pnpm build`。

不要使用 `git reset --hard`、`git checkout --` 覆盖用户改动，也不要整体恢复
`4adb487`，因为那会同时恢复上游已经删除的其他历史功能并增加冲突。
