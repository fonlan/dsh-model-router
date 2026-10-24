# 变更记录

兼容性一栏列出该版本支持的 DSH 宿主版本区间。

## 0.3.11

**兼容性**：dsh `^0.1.2-alpha.2 || ^0.2.0-rc.1 || ^0.2.1-alpha.1 || ^0.2.1-rc.2 || ^0.2.1-rc.3` —— 已在 DSH Desktop `0.2.1-rc.3` 上验证（隔离 profile 冷启动 `pass-timeout-alive`）。

**变更**
- 构建基线 `@deepseek-ai/*` 从 `0.2.1-rc.2` 升到 `0.2.1-rc.3`（`@deepseek-ai/cordis` `4.0.5`、`@deepseek-ai/schemastery` `3.18.5` 不变）。
- 每个 `@deepseek-ai/dsh*` 的 `peerDependencies` 追加 `|| ^0.2.1-rc.3`。
- 源码零改动：`0.2.1-rc.2 → 0.2.1-rc.3` 的宿主变化是新增 entry 自定义菜单/图标与两个新槽位（`sidebar.panellist.actions`、`conversation.session.header.views.actions`），未触及本插件消费的 API（typecheck 通过）。

**验证**：`pnpm install` / `typecheck` / `build` / `test`（66 项）全部通过；隔离 profile 冷启动（真 `0.2.1-rc.3` 宿主）通过。

## 0.3.10

**兼容性**：dsh `^0.1.2-alpha.2 || ^0.2.0-rc.1 || ^0.2.1-alpha.1 || ^0.2.1-rc.2` —— 已在 DSH Desktop `0.2.1-rc.2` 上验证（隔离 profile 冷启动 `pass-timeout-alive`）；dsh web `0.2.1-alpha.2` 仍落在同一 peer 区间内（门禁离线求值 ADMITTED）。

**变更**
- 构建基线 `@deepseek-ai/*` 从 `0.2.1-alpha.1` 升到 `0.2.1-rc.2`（含 `@deepseek-ai/cordis` `4.0.5`、`@deepseek-ai/schemastery` `3.18.5`）。
- 每个 `@deepseek-ai/dsh*` 的 `peerDependencies` 追加 `|| ^0.2.1-rc.2`。
- 源码零改动：`0.2.1-alpha.1 → 0.2.1-rc.2` 的声明面变化未触及本插件消费的 API（typecheck 通过）。

**验证**：`pnpm install` / `typecheck` / `build` / `test`（66 项）全部通过；隔离 profile 冷启动（真 `0.2.1-rc.2` 宿主）通过。

## 0.3.9

**兼容性**：dsh `^0.1.2-alpha.2 || ^0.2.0-rc.1 || ^0.2.1-alpha.1` —— 已在 dsh web `0.2.1-alpha.1` 与 DSH Desktop `0.2.0-rc.2` 上验证。

**变更**
- 构建基线 `@deepseek-ai/*` 从 `0.2.0-rc.1` 升到 `0.2.1-alpha.1`（含 `@deepseek-ai/cordis` `4.0.5-alpha.1`、`@deepseek-ai/schemastery` `3.18.5-alpha.1`）。
- 每个 `@deepseek-ai/dsh*` 的 `peerDependencies` 追加 `|| ^0.2.1-alpha.1`。
- 删除 `@deepseek-ai/dsh-invariants` devDependency：该包在 `0.2.1-alpha.1` 已下线。

**验证**：`pnpm install` / `typecheck` / `build` / `test`（66 项）全部通过；隔离 profile 冷启动（真 `0.2.1-alpha.1` 宿主）通过。
