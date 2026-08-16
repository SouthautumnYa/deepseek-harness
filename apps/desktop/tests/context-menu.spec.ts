import { describe, expect, it } from 'vitest'
import { buildEditContextMenuTemplate } from '../src/context-menu.ts'

const flags = {
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
}

describe('desktop native edit context menu', () => {
  it('maps editable Chromium flags to cut/copy/paste/select-all roles', () => {
    const items = buildEditContextMenuTemplate({ isEditable: true, selectionText: '', editFlags: flags })
    expect(items.map(item => 'role' in item ? item.role : item.type)).toEqual([
      'cut', 'copy', 'paste', 'separator', 'selectAll',
    ])
  })

  it('keeps paste enabled when Chromium reports a stale paste flag', () => {
    const items = buildEditContextMenuTemplate({
      isEditable: true,
      selectionText: '',
      editFlags: { ...flags, canPaste: false },
    })
    expect(items.find(item => 'role' in item && item.role === 'paste')).toMatchObject({ enabled: true })
  })

  it('keeps message text selectable without exposing paste', () => {
    const items = buildEditContextMenuTemplate({
      isEditable: false,
      selectionText: 'selected message',
      editFlags: { ...flags, canPaste: false },
    })
    expect(items.map(item => 'role' in item ? item.role : item.type)).toEqual(['copy', 'separator', 'selectAll'])
  })
})
