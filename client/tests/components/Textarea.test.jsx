import { render, screen } from '@testing-library/react'
import { Textarea } from '../../src/components/ui/textarea.jsx'

test('renders a textarea element', () => {
  render(<Textarea placeholder="Enter pattern" />)
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})

test('displays passed value', () => {
  render(<Textarea value="await db.select()" onChange={() => {}} />)
  expect(screen.getByRole('textbox')).toHaveValue('await db.select()')
})

test('applies extra className', () => {
  const { container } = render(<Textarea className="font-mono" />)
  expect(container.querySelector('textarea')).toHaveClass('font-mono')
})

test('forwards rows prop', () => {
  const { container } = render(<Textarea rows={3} />)
  expect(container.querySelector('textarea')).toHaveAttribute('rows', '3')
})
