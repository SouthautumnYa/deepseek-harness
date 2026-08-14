import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

type EditContextFlags = Pick<ContextMenuParams['editFlags'], 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'>

/** Build the native edit menu for text inputs and selectable message text. */
export function buildEditContextMenuTemplate(
  params: { isEditable: boolean; selectionText: string; editFlags: EditContextFlags },
): MenuItemConstructorOptions[] {
  const { isEditable, selectionText, editFlags } = params
  const items: MenuItemConstructorOptions[] = []

  if (isEditable) {
    items.push(
      { label: '剪切', role: 'cut', enabled: editFlags.canCut },
      { label: '复制', role: 'copy', enabled: editFlags.canCopy },
      { label: '粘贴', role: 'paste', enabled: editFlags.canPaste },
    )
  } else if (selectionText.length > 0) {
    items.push({ label: '复制', role: 'copy', enabled: true })
  }

  if (isEditable || selectionText.length > 0) {
    items.push(
      { type: 'separator' },
      { label: '全选', role: 'selectAll', enabled: editFlags.canSelectAll || isEditable },
    )
  }
  return items
}
