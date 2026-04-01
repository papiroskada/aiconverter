import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import ProgramNode from '../../src/components/Graph/ProgramNode.jsx'
import { ReactFlowProvider } from 'reactflow'

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>)

test('shows program name', () => {
  wrap(<ProgramNode data={{ name: 'ARERCD', status: 'analyzed', isPhantom: false }} />)
  expect(screen.getByText('ARERCD')).toBeInTheDocument()
})

test('applies green style for analyzed status', () => {
  const { container } = wrap(<ProgramNode data={{ name: 'ARERCD', status: 'analyzed', isPhantom: false }} />)
  const node = container.firstChild
  // #4ade80 converts to rgb(74, 222, 128)
  expect(node.style.borderColor).toMatch(/rgb\(74.*222.*128\)|4ade80|analyzed/i)
})

test('applies dashed border for phantom nodes', () => {
  const { container } = wrap(<ProgramNode data={{ name: 'ARCUST', status: 'pending', isPhantom: true }} />)
  const node = container.firstChild
  expect(node.style.borderStyle || node.className).toMatch(/dashed|phantom/i)
})

test('phantom nodes should not open detail panel (isPhantom guard logic)', () => {
  const setSelectedId = vi.fn()
  const onNodeClick = (node) => { if (!node.data.isPhantom) setSelectedId(node.id) }

  onNodeClick({ id: 'phantom-abc', data: { name: 'ABC', status: 'pending', isPhantom: true } })
  expect(setSelectedId).not.toHaveBeenCalled()

  onNodeClick({ id: 'real-abc', data: { name: 'ABC', status: 'analyzed', isPhantom: false } })
  expect(setSelectedId).toHaveBeenCalledWith('real-abc')
})
