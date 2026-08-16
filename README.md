# dsh-model-router

**dsh-model-router** 是一个 [DSH](https://github.com/deepseek-ai/dsh) 插件，向 harness 注册一个虚拟模型提供商 `model-router`：它汇聚用户已添加的**所有**提供商及其模型（按 model id 严格归并），并在每次 LLM 请求发出时把请求实时路由到该模型**当前激活**的提供商。配套的独立设置页支持按模型对提供商拖拽排序（供后续自动切换使用）与点击切换当前提供商；切换后全局立即生效——下一次发出的该模型请求即走新提供商。

## 功能

- **虚拟提供商 `model-router`**：出现在输入框下方的模型选择器（含默认模型设置等所有选择入口）中，列出全部已配置提供商的所有模型，模型条目副文本标注当前激活的提供商（如 `via OpenCode Go`）。
- **严格按 model id 归并**：同一模型出现在多个提供商时归并为一条；展示名、上下文窗口、推理档位等参数跟随当前激活的提供商。
- **请求时实时路由**：会话中始终保存 `provider=model-router`，每次请求发出时进程内解析当前激活提供商并委派给真实 adapter（凭据解析、重试、流式、计量全部走原管线），主 agent、子代理、工具 LLM 调用一视同仁。
- **独立设置页**（设置 → 模型路由）：每个模型下列出其全部提供商——点击切换当前使用；拖拽调整优先级顺序（供后续自动切换策略使用）；未配置 API 密钥的提供商标灰不可选。
- **自动配置维护**：新增/删除提供商或模型后配置自动同步（消失的提供商从排序中清理、激活自动回落到剩余第一位、新提供商追加到排序末尾）；未配置过的模型自动选择排序第一位。
- **失败即报错**：当前提供商请求失败直接返回错误（自动切换为后续规划功能）。
- **双语**：设置页文案中英双语，跟随界面语言。
- **通用运行时**：核心路由逻辑与 UI 解耦——web profile 提供设置页与选择器；CLI / headless profile 装上同样按配置路由（可直接手改 `settings.yaml` 的 `model-router:` 段）。

## 配置

路由配置持久化在 settings 文档的 `model-router` 命名空间（`~/.dsh/settings.yaml`）：

```yaml
model-router:
  models:
    deepseek-v4-flash:
      order:            # 优先级顺序（供后续自动切换使用）
        - opencode-go
        - deepseek-official
      active: opencode-go   # 当前实际使用的提供商
```

`order` 与 `active` 分开维护：点击切换只改 `active`，拖拽排序只改 `order`。

## 安装

### 方式一：从 npm 发布包安装

```sh
dsh plugin --profile web add @fonlan/dsh-model-router
```

### 方式二：本地源码链接安装

在仓库目录下构建出 `lib/` 产物后以本地目录方式添加：

```sh
pnpm build
dsh plugin --profile web add .
```

安装后插件通过 `cordis.patch.yml` 自动挂载到目标 profile：服务端注册 `model-router` 提供商与路由配置，web 端注册 `settings.section` 设置页。重启 profile 后生效（web profile 重启后，输入框下方的模型选择器即出现 Model Router 分组）。

## 开发

```sh
pnpm install     # 安装依赖
pnpm build       # 构建 lib/（tsc 声明 + tsdown 双端产物）
pnpm test        # vitest 单测（归并/路由解析/委派等纯逻辑）
pnpm typecheck   # server + client 双 tsconfig 类型检查
```

- 修改服务端后需重启 profile。
- 客户端改动走 web 端 HMR 链路，`pnpm run dev:web` 同启时生效。

## License

MIT — 详见 [LICENSE](./LICENSE)。
