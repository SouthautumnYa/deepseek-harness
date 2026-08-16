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
      // Electron can report `canPaste: false` for contenteditable elements
      // while the native paste role still works with the system clipboard.
      { label: '粘贴', role: 'paste', enabled: true },
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
