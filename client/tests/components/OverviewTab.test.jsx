import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi } from 'vitest'
import OverviewTab from '../../src/components/Panel/OverviewTab.jsx'

// Mock mermaid
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>diagram</svg>' }),
  },
}))

const analysisWithDiagram = {
  description: 'Validates customer data.',
  call_parameters: [{ name: 'WS-PARAM', type: 'input', description: 'Customer ID' }],
  diagram: 'flowchart TD\n  A --> B',
}

const analysisNoDiagram = {
  description: 'Simple program.',
  call_parameters: [],
  diagram: null,
}

test('shows "No analysis yet." when analysis is null', () => {
  render(<OverviewTab analysis={null} />)
  expect(screen.getByText('No analysis yet.')).toBeInTheDocument()
})

test('renders description text', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  expect(screen.getByText('Validates customer data.')).toBeInTheDocument()
})

test('renders diagram container when diagram is present', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  expect(screen.getByTitle('Fullscreen')).toBeInTheDocument()
})

test('shows "Diagram not available." when diagram is null', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisNoDiagram} />)
  })
  expect(screen.getByText('Diagram not available.')).toBeInTheDocument()
})

test('opens fullscreen overlay on button click', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  const btn = screen.getByTitle('Fullscreen')
  await act(async () => { fireEvent.click(btn) })
  expect(document.querySelector('[data-testid="fullscreen-overlay"]')).not.toBeNull()
})

test('closes fullscreen overlay when clicking outside the diagram', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  await act(async () => { fireEvent.click(screen.getByTitle('Fullscreen')) })
  const overlay = document.querySelector('[data-testid="fullscreen-overlay"]')
  await act(async () => { fireEvent.click(overlay) })
  expect(document.querySelector('[data-testid="fullscreen-overlay"]')).toBeNull()
})

test('closes fullscreen overlay on Escape key', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  await act(async () => { fireEvent.click(screen.getByTitle('Fullscreen')) })
  await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(document.querySelector('[data-testid="fullscreen-overlay"]')).toBeNull()
})

test('calls mermaid.render a second time when fullscreen opens', async () => {
  const mermaid = (await import('mermaid')).default
  mermaid.render.mockClear()

  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  expect(mermaid.render).toHaveBeenCalledTimes(1)

  await act(async () => { fireEvent.click(screen.getByTitle('Fullscreen')) })
  expect(mermaid.render).toHaveBeenCalledTimes(2)
})

const analysisWithCalls = {
  description: 'Calls external programs.',
  call_parameters: [],
  diagram: null,
  external_calls: [{ program: 'c_writelnkarea', using: 'PGM-NM' }],
}

test('renders external calls in overview when present', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithCalls} />)
  })
  expect(screen.getByText(/c_writelnkarea/)).toBeInTheDocument()
})
