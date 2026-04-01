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

// --- External Calls section ---

test('renders External Calls section with program (using) format', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_calls: [
        { program: 'c_writelnkarea', using: 'PGM-NM' },
        { program: 'c_getplenv', using: 'WGET-USR' },
      ]}}
    />
  )
  expect(screen.getByText('c_writelnkarea (PGM-NM)')).toBeInTheDocument()
  expect(screen.getByText('c_getplenv (WGET-USR)')).toBeInTheDocument()
})

test('hides External Calls section when external_calls is empty', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_calls: [] }}
    />
  )
  expect(screen.queryByText(/external calls/i)).not.toBeInTheDocument()
})

test('hides External Calls section when analysis is null', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={null}
    />
  )
  expect(screen.queryByText(/external calls/i)).not.toBeInTheDocument()
})

test('renders External Call with no using param as program name only', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_calls: [{ program: 'c_standalone', using: '' }] }}
    />
  )
  expect(screen.getByText('c_standalone')).toBeInTheDocument()
  expect(screen.queryByText('c_standalone ()')).not.toBeInTheDocument()
})
