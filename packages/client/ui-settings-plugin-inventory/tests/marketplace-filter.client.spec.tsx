// @vitest-environment jsdom

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type ClientModule = {
  apply(context: unknown): void
}

type ModuleLoader = {
  load(definition: {
    factory(require: (name: string) => unknown): ClientModule
  }): void
}

const windowWithLoader = window as typeof window & { __ModuleLoader__?: ModuleLoader }
const previousLoader = windowWithLoader.__ModuleLoader__
let clientModule: ClientModule | undefined

const zh: Record<string, string> = {
  sectionLabel: 'DSH插件市场',
  pageSub: '插件列表',
  refresh: '刷新',
  loading: '正在加载',
  countTotal: '共 {n} 个插件',
  countMatch: '，匹配 {n} 个',
  noMatch: '没有匹配「{q}」的插件',
  empty: '没有找到插件',
  searchPlaceholder: '搜索插件名（如 pdf、image、ppt）...',
  catAll: '全部',
  catVision: '视觉多模态',
  catDocument: '文档办公',
  catMemory: '记忆知识',
  catModel: '模型用量',
  catNotify: '通知通讯',
  catCoding: '开发编码',
  catConversation: '对话会话',
  catWebUi: '界面美化',
  catAgent: 'Agent 自动化',
  catTool: '通用工具',
  catResource: '聚合资源',
  catOther: '其他',
}

function translate(key: string, variables?: Record<string, unknown>) {
  let text = zh[key] ?? key
  for (const [name, value] of Object.entries(variables ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function captureMarketplaceSection() {
  if (!clientModule) throw new Error('marketplace client did not load')
  let Section: React.ComponentType | undefined
  clientModule.apply({
    effect: () => undefined,
    locale: {
      register: () => () => undefined,
      bind: () => translate,
      getLocale: () => ({ active: 'zh' }),
      subscribe: () => () => undefined,
    },
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (_entry: unknown, component: React.ComponentType) => {
        Section = component
        return () => undefined
      },
    },
  })
  if (!Section) throw new Error('marketplace settings section was not registered')
  return Section
}

function mockMarketplace(repos: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => ({ repos }),
  })))
}

beforeAll(async () => {
  windowWithLoader.__ModuleLoader__ = {
    load(definition) {
      clientModule = definition.factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected client dependency: ${name}`)
      })
    },
  }
  const clientPath = resolve(
    process.cwd(),
    'packages/bundle/web-app/node_modules/dsh-plugin-marketplace/lib/client.js',
  )
  const source = readFileSync(clientPath, 'utf8')
  const clientUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  await import(/* @vite-ignore */ clientUrl)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

afterAll(() => {
  if (previousLoader) windowWithLoader.__ModuleLoader__ = previousLoader
  else delete windowWithLoader.__ModuleLoader__
})

describe('marketplace category and search filters', () => {
  it('matches a normalized category and intersects it with text search', async () => {
    mockMarketplace([
      {
        full_name: 'demo/vision-kit',
        name: 'Vision Kit',
        category: ['VISION'],
        topics: [],
        tags: 'image, multimodal',
        stargazers_count: 2,
      },
      {
        full_name: 'demo/coding-kit',
        name: 'Coding Kit',
        category: 'coding',
        topics: ['typescript'],
        stargazers_count: 1,
      },
    ])
    const Section = captureMarketplaceSection()
    render(<Section />)

    await screen.findByText('Vision Kit')
    fireEvent.click(screen.getByRole('button', { name: '视觉多模态' }))
    expect(screen.getByText('Vision Kit')).toBeTruthy()
    expect(screen.queryByText('Coding Kit')).toBeNull()
    expect(screen.getByText('共 2 个插件，匹配 1 个')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'image' } })
    expect(screen.getByText('Vision Kit')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    await waitFor(() => {
      expect(screen.getByText('没有匹配「missing」的插件')).toBeTruthy()
    })
  })

  it('uses the selected category in the empty-state message instead of blank quotes', async () => {
    mockMarketplace([{
      full_name: 'demo/coding-kit',
      name: 'Coding Kit',
      category: 'coding',
      topics: [],
      stargazers_count: 1,
    }])
    const Section = captureMarketplaceSection()
    render(<Section />)

    await screen.findByText('Coding Kit')
    fireEvent.click(screen.getByRole('button', { name: '视觉多模态' }))
    expect(screen.getByText('没有匹配「视觉多模态」的插件')).toBeTruthy()
    expect(screen.queryByText('没有匹配「」的插件')).toBeNull()
  })
})
