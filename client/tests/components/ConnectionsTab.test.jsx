import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ConnectionsTab from '../../src/components/Panel/ConnectionsTab.jsx'

const programId = 'prog-a'

const edges = [
  {
    from_program_id: 'prog-b',
    to_program_id: programId,
    to_program_name: 'PROG-A',
    to_program_status: 'analyzed',
    from_program_name: 'PROG-B',
  },
  {
    from_program_id: programId,
    to_program_id: 'prog-c',
    to_program_name: 'PROG-C',
    to_program_status: 'pending',
    from_program_name: 'PROG-A',
  },
  {
    from_program_id: programId,
    to_program_id: null,
    to_program_name: 'PROG-D',
    to_program_status: null,
    from_program_name: 'PROG-A',
  },
]

describe('ConnectionsTab', () => {
  it('shows "not analyzed" badge for pending target program', () => {
    render(<ConnectionsTab edges={edges} programId={programId} onNavigate={vi.fn()} />)
    expect(screen.getByText('not analyzed')).toBeInTheDocument()
  })

  it('shows "not uploaded" badge for null to_program_id', () => {
    render(<ConnectionsTab edges={edges} programId={programId} onNavigate={vi.fn()} />)
    expect(screen.getByText('not uploaded')).toBeInTheDocument()
  })

  it('does not call onNavigate when clicking pending target', () => {
    const onNavigate = vi.fn()
    render(<ConnectionsTab edges={edges} programId={programId} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('PROG-C'))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('calls onNavigate when clicking analyzed target', () => {
    const onNavigate = vi.fn()
    render(<ConnectionsTab edges={edges} programId={programId} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('PROG-B'))
    expect(onNavigate).toHaveBeenCalledWith('prog-b')
  })
})

// --- External Dependencies section ---

test('renders External Dependencies section with program heading', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_dependencies: [
        { program: 'C_CURPID', purpose: 'Gets current process ID', dataIn: 'none', dataOut: 'process ID' },
      ]}}
    />
  )
  expect(screen.getByText('C_CURPID')).toBeInTheDocument()
})

test('renders External Dependencies purpose', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_dependencies: [
        { program: 'C_CURPID', purpose: 'Gets current process ID', dataIn: 'none', dataOut: 'process ID' },
      ]}}
    />
  )
  expect(screen.getByText('Gets current process ID')).toBeInTheDocument()
})

test('renders External Dependencies dataIn and dataOut', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_dependencies: [
        { program: 'C_CURPID', purpose: 'Gets current process ID', dataIn: 'none', dataOut: 'process ID' },
      ]}}
    />
  )
  expect(screen.getByText(/→ in: none/)).toBeInTheDocument()
  expect(screen.getByText(/← out: process ID/)).toBeInTheDocument()
})

test('renders External Dependencies label with count', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_dependencies: [
        { program: 'C_CURPID', purpose: 'Gets current process ID', dataIn: 'none', dataOut: 'process ID' },
      ]}}
    />
  )
  expect(screen.getByText('External Dependencies (1)')).toBeInTheDocument()
})

test('hides External Dependencies section when external_dependencies is empty', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_dependencies: [] }}
    />
  )
  expect(screen.queryByText(/external dependencies/i)).not.toBeInTheDocument()
})

test('hides External Dependencies section when analysis is null', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={null}
    />
  )
  expect(screen.queryByText(/external dependencies/i)).not.toBeInTheDocument()
})
