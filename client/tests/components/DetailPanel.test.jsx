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

test('shows progress bar and log feed when programId matches progressForId', async () => {
  const events = [
    { stage: 'parsing', message: 'Parsing COBOL file...' },
    { stage: 'parsing', message: 'Parsed 5 chunks', durationMs: 200 },
    { stage: 'metadata', message: 'Analyzing metadata...' },
  ]

  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={events}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  // Progress log entries should be visible (using getAllByText to handle duplication in label and log)
  expect(screen.getAllByText(/Parsing COBOL file/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Parsed 5 chunks/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Analyzing metadata/).length).toBeGreaterThan(0)
})

test('shows done-type entries with ✓ icon', async () => {
  const events = [
    { stage: 'parsing', message: 'Parsed 5 chunks', durationMs: 200 },
  ]

  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={events}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.getByText('✓')).toBeInTheDocument()
})

test('shows error-type entries with ✗ icon', async () => {
  const events = [
    { stage: 'chunk', message: 'Chunk 1/5 failed: timeout', chunkIndex: 1, total: 5, durationMs: 2000 },
  ]

  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={events}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.getByText('✗')).toBeInTheDocument()
  expect(screen.getAllByText(/Chunk 1\/5 failed/).length).toBeGreaterThan(0)
})

test('does not show progress UI when programId does not match progressForId', async () => {
  render(
    <DetailPanel
      programId="abc"
      progressForId="different-id"
      progressEvents={[{ stage: 'parsing', message: 'Parsing...' }]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  expect(screen.queryByText('Parsing...')).not.toBeInTheDocument()
})

test('does not show progress UI when progressEvents is empty', async () => {
  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  // No log entries rendered
  expect(screen.queryByText('✓')).not.toBeInTheDocument()
  expect(screen.queryByText('▶')).not.toBeInTheDocument()
})

test('disables delete button while program is analyzing', async () => {
  render(
    <DetailPanel
      programId="abc"
      progressForId={null}
      progressEvents={[]}
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
      progressForId={null}
      progressEvents={[]}
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
      progressForId={null}
      progressEvents={[]}
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
      progressForId={null}
      progressEvents={[]}
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
      progressForId={null}
      progressEvents={[]}
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
      progressForId={null}
      progressEvents={[]}
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
