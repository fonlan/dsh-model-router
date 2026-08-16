// Locale namespace = the plugin's cordis id (kebab). DSH flat namespace keys
// (settings + locale) use the internal id `model-router`; the scoped npm
// package name is reserved for package-bound identifiers (exported `name`,
// module-loader id, the /plugins/<pkg>/… route base).
export const LOCALE_NS = 'model-router'

export const zh = {
  settingsTitle: '模型路由',
  settingsDescription: '每个模型按 model id 聚合所有提供商；点击提供商切换该模型当前使用的路由，拖拽调整优先级顺序（供后续自动切换使用）。',
  loading: '加载中…',
  loadFailed: '加载失败：{message}',
  retry: '重试',
  refresh: '刷新',
  empty: '没有可路由的提供商或模型，请先在设置中添加提供商。',
  modelsCount: '共 {count} 个模型',
  activeBadge: '当前',
  noCredential: '未配置 API 密钥，不可选',
  dragHint: '拖拽调整优先级顺序',
  switchFailed: '切换失败：{message}',
  reorderFailed: '排序失败：{message}',
  providerCount: '{count} 个提供商',
}

export const en = {
  settingsTitle: 'Model Router',
  settingsDescription: 'Each model aggregates its providers by exact model id. Click a provider to switch where this model currently routes; drag to adjust the preference order (used by automatic failover later).',
  loading: 'Loading…',
  loadFailed: 'Load failed: {message}',
  retry: 'Retry',
  refresh: 'Refresh',
  empty: 'No routable providers or models yet — add providers in settings first.',
  modelsCount: '{count} models',
  activeBadge: 'active',
  noCredential: 'No API key configured — not selectable',
  dragHint: 'Drag to adjust preference order',
  switchFailed: 'Switch failed: {message}',
  reorderFailed: 'Reorder failed: {message}',
  providerCount: '{count} providers',
}
