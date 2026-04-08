import { render, screen } from '@testing-library/react'
import DataTab from '../../src/components/Panel/DataTab.jsx'

test('shows empty message when db_tables and file_ops are both empty', () => {
  render(<DataTab analysis={{ db_tables: [], file_ops: [] }} />)
  expect(screen.getByText('No database tables or file operations found.')).toBeInTheDocument()
})

test('shows empty message when analysis is null', () => {
  render(<DataTab analysis={null} />)
  expect(screen.getByText('No database tables or file operations found.')).toBeInTheDocument()
})

test('renders table name and operation for each db_table entry', () => {
  render(<DataTab analysis={{
    db_tables: [
      { table: 'ECO', operation: 'READ', fields: ['ECO-KEY-CD', 'ECO-STATUS'] },
      { table: 'SYTABLEP', operation: 'READ/WRITE', fields: [] },
    ]
  }} />)
  expect(screen.getByText('ECO')).toBeInTheDocument()
  expect(screen.getByText('READ')).toBeInTheDocument()
  expect(screen.getByText('ECO-KEY-CD, ECO-STATUS')).toBeInTheDocument()
  expect(screen.getByText('SYTABLEP')).toBeInTheDocument()
  expect(screen.getByText('READ/WRITE')).toBeInTheDocument()
})

test('does not render fields line when fields array is empty', () => {
  render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'WRITE', fields: [] }] }} />)
  expect(screen.queryByText(',')).not.toBeInTheDocument()
})

test('opColor: READ-only operation renders with green color', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'READ', fields: [] }] }} />)
  const opSpan = container.querySelector('span[style*="rgb(74, 222, 128)"]')
  expect(opSpan).not.toBeNull()
})

test('opColor: WRITE-only operation renders with red color', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'WRITE', fields: [] }] }} />)
  const opSpan = container.querySelector('span[style*="rgb(248, 113, 113)"]')
  expect(opSpan).not.toBeNull()
})

test('opColor: READ/WRITE compound operation renders with amber color', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'READ/WRITE', fields: [] }] }} />)
  const opSpan = container.querySelector('span[style*="rgb(245, 158, 11)"]')
  expect(opSpan).not.toBeNull()
})

test('opColor: READ/DELETE compound operation renders with amber color', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'READ/DELETE', fields: [] }] }} />)
  const opSpan = container.querySelector('span[style*="rgb(245, 158, 11)"]')
  expect(opSpan).not.toBeNull()
})
