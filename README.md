# dsh-model-router

**dsh-model-router** 是一个 [DSH](https://github.com/deepseek-ai/dsh) 插件，向 harness 注册一个虚拟模型提供商 `model-router`：它汇聚用户已添加的**所有**提供商及其模型（按 model id 严格归并），并在每次 LLM 请求发出时把请求实时路由到该模型**当前激活**的提供商。配套的设置卡片（设置 → 插件 → 插件配置 → 模型路由）支持按模型对提供商拖拽排序（供后续自动切换使用）与点击切换当前提供商；切换后全局立即生效——下一次发出的该模型请求即走新提供商。

## 功能

- **虚拟提供商 `model-router`**：出现在输入框下方的模型选择器（含默认模型设置等所有选择入口）中，列出全部已配置提供商的所有模型，模型条目副文本标注当前激活的提供商（如 `via OpenCode Go`）。
- **快速路由切换**：当当前会话选择的是 `model-router` 模型时，输入栏模型选择器右侧显示当前 provider 按钮；点击打开 provider 面板，可直接切换该模型的激活 provider。切换对所有会话的后续请求生效，完整排序和全量管理仍在设置 → 插件 → 插件配置 → 模型路由中完成。可在设置 → 插件 → 插件配置 → 模型路由中通过「在输入栏显示快速路由切换按钮」开关控制该按钮是否显示。当 router 全局只有一个提供商、或当前模型仅由一个提供商服务时，按钮自动隐藏（无可切换对象）。
- **严格按 model id 归并**：同一模型出现在多个提供商时归并为一条；展示名、上下文窗口、推理档位等参数跟随当前激活的提供商。
- **忽略模型 ID 前缀**（默认开启）：`deepseek/deepseek-v4-flash` 与 `deepseek-v4-flash` 视为同一模型，统一显示不带前缀的模型 id；请求时传入带前缀的 id 也能命中同一路由。每个提供商条目保留自己的原始 id，委派时按原始 id 发给真实提供商。可在设置 → 插件 → 插件配置 → 模型路由中通过「匹配时忽略模型 ID 前缀」开关控制。
- **请求时实时路由**：会话中始终保存 `provider=model-router`，每次请求发出时进程内解析当前激活提供商并委派给真实 adapter（凭据解析、重试、流式、计量全部走原管线），主 agent、子代理、工具 LLM 调用一视同仁。
- **设置卡片**（设置 → 插件 → 插件配置 → 模型路由，可展开式卡片）：每个模型下列出其全部提供商——点击切换当前使用；拖拽调整优先级顺序（供后续自动切换策略使用）；未配置 API 密钥的提供商标灰不可选。
- **模型显示顺序可配置**：设置卡片中可切换 model-router 分组在模型选择列表中的排列方式——自定义（手动拖拽模型顺序）、按名称（数字感知）、最近使用（最近请求过的模型排最前，未用过的排最后）。切换与拖拽全局即时生效。
- **自动配置维护**：新增/删除提供商或模型后配置自动同步（消失的提供商从排序中清理、激活自动回落到剩余第一位、新提供商追加到排序末尾、消失的模型从自定义顺序中清理、新模型追加到自定义顺序末尾）；未配置过的模型自动选择排序第一位。
- **失败即报错**：当前提供商请求失败直接返回错误（自动切换为后续规划功能）。
- **双语**：设置卡片文案中英双语，跟随界面语言。
- **通用运行时**：核心路由逻辑与 UI 解耦——web profile 提供设置卡片与选择器；CLI / headless profile 装上同样按配置路由（可直接手改 `settings.yaml` 的 `model-router:` 段）。

## 配置

路由配置持久化在 settings 文档的 `model-router` 命名空间（`~/.dsh/settings.yaml`）：

```yaml
model-router:
  showQuickSwitch: true   # 是否在输入栏显示快速路由切换按钮（默认 true）
  ignoreModelIdPrefix: true  # 匹配时忽略模型 ID 前缀（默认 true）
  modelSort: custom       # 模型显示顺序：custom | name | recent（默认 custom）
  modelOrder:             # custom 模式下的模型显示顺序（自动维护，无需手写）
    - deepseek-v4-flash
    - qwen3.7-max
  recentlyUsed:           # recent 模式使用：模型 id → 最后使用时间戳（自动维护）
    deepseek-v4-flash: 1787036509332
  models:
    deepseek-v4-flash:
      order:            # 优先级顺序（供后续自动切换使用）
        - opencode-go
        - deepseek-official
      active: opencode-go   # 当前实际使用的提供商
```

`order` 与 `active` 分开维护：点击切换只改 `active`，拖拽排序只改 `order`。`modelOrder` 与 `recentlyUsed` 由插件自动维护（`modelSort: recent` 时每次模型请求都会更新对应时间戳，防抖写入）。

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

安装后插件通过 `cordis.patch.yml` 自动挂载到目标 profile：服务端注册 `model-router` 提供商与路由配置，web 端注册 `settings.plugin.item` 设置卡片（键 = `model-router` 设置命名空间，即设置 → 插件 → 插件配置 → 模型路由）。重启 profile 后生效（web profile 重启后，输入框下方的模型选择器即出现 Model Router 分组）。

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
