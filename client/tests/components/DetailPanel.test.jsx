import { render, screen, act, fireEvent } from '@testing-library/react'
import DetailPanel from '../../src/components/Panel/DetailPanel.jsx'
import { vi } from 'vitest'

// Mock fetchProgram so the component doesn't make real HTTP calls
vi.mock('../../src/api/programs.js', () => ({
  fetchProgram: vi.fn(() => Promise.resolve({
    name: 'ARERCD',
    status: 'analyzing',
    analysis: null,
    chunks: [],
    edges: [],
  })),
  deleteProgram: vi.fn(() => Promise.resolve()),
}))

const noop = () => {}

test('shows progress bar when programId is in stepProgress', async () => {
  const stepProgress = new Map([['abc', { step: 1, total: 2 }]])

  render(
    <DetailPanel
      programId="abc"
      stepProgress={stepProgress}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.getByText('Analyzing…')).toBeInTheDocument()
  expect(screen.getByText('Step 1 of 2 (50%)')).toBeInTheDocument()
})

test('does not show progress UI when programId not in stepProgress', async () => {
  const stepProgress = new Map([['other-id', { step: 1, total: 2 }]])

  render(
    <DetailPanel
      programId="abc"
      stepProgress={stepProgress}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.queryByText('Analyzing…')).not.toBeInTheDocument()
})

test('does not show progress UI when stepProgress is empty', async () => {
  render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.queryByText('Analyzing…')).not.toBeInTheDocument()
})

test('disables delete button while program is analyzing', async () => {
  render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
})

// --- Resizable panel ---

test('restores panel width from localStorage on mount', async () => {
  localStorage.setItem('panelWidth', '450')
  const { container } = render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})
  const panel = container.firstChild
  expect(panel.style.width).toBe('450px')
  localStorage.removeItem('panelWidth')
})

test('defaults panel width to 340 when localStorage is empty', async () => {
  localStorage.removeItem('panelWidth')
  const { container } = render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})
  const panel = container.firstChild
  expect(panel.style.width).toBe('340px')
})

test('clamps panel width to minimum 280 during resize', async () => {
  const { container } = render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  const handle = container.firstChild.querySelector('[style*="col-resize"]')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 100 })
  fireEvent.mouseUp(document)

  const w = parseInt(container.firstChild.style.width)
  expect(w).toBeGreaterThanOrEqual(280)
})

test('clamps panel width to maximum 600 during resize', async () => {
  const { container } = render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  const handle = container.firstChild.querySelector('[style*="col-resize"]')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: 0 })
  fireEvent.mouseUp(document)

  const w = parseInt(container.firstChild.style.width)
  expect(w).toBeLessThanOrEqual(600)
})

test('persists panel width to localStorage on mouseup', async () => {
  localStorage.removeItem('panelWidth')
  const { container } = render(
    <DetailPanel
      programId="abc"
      stepProgress={new Map()}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  const handle = container.firstChild.querySelector('[style*="col-resize"]')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 400 })
  fireEvent.mouseUp(document)

  expect(localStorage.getItem('panelWidth')).not.toBeNull()
})
