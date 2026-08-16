/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'trigger.ariaSpeed': '选择模型，当前 {model}，速度 {speed}',
  'trigger.ariaEffortSpeed': '选择模型，当前 {model}，推理等级 {effort}，速度 {speed}',
  'menu.aria': '模型、推理等级与速度',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'menu.speed': '速度',
  'effort.providerDefault': 'Default',
  'speed.standard': '标准',
  'speed.fast': '快速',
  'speed.loading': '读取中',
  'speed.unavailable': '不可用',
  'speed.standardDescription': '使用当前模型的默认速度。',
  'speed.fastDescription': '使用当前模型已声明的原生 Fast 策略。',
  'speed.unavailableDescription': '当前模型未声明可用的 Fast 协议。',
  'action.resetDefaults': '重置为默认设置',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'trigger.ariaSpeed': 'Select model, current {model}, speed {speed}',
  'trigger.ariaEffortSpeed': 'Select model, current {model}, reasoning effort {effort}, speed {speed}',
  'menu.aria': 'Model, reasoning effort, and speed',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'menu.speed': 'Speed',
  'effort.providerDefault': 'Default',
  'speed.standard': 'Standard',
  'speed.fast': 'Fast',
  'speed.loading': 'Loading',
  'speed.unavailable': 'Unavailable',
  'speed.standardDescription': 'Use the model default speed.',
  'speed.fastDescription': 'Use the model\'s declared native Fast strategy.',
  'speed.unavailableDescription': 'This model has no declared Fast contract.',
  'action.resetDefaults': 'Reset to default settings',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>
