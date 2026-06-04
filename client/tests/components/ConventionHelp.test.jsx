import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('@/api/client.js', () => ({
  apiFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      ai_provider: 'claude',
      claude_api_key: null,
      openai_api_key: null,
      claude_model_interface: 'claude-sonnet-4-6',
      claude_model_rules: 'claude-haiku-4-5-20251001',
      openai_model_interface: 'gpt-4o',
      openai_model_rules: 'gpt-4o-mini',
      code_db_read: '',
      code_db_write: '',
      code_error_convention: '',
      code_external_call: '',
      code_language: 'typescript',
      code_source_mode: 'with_source',
    }),
  }),
  apiJson: vi.fn(),
}))

import SettingsPage from '../../src/pages/admin/SettingsPage.jsx'

test('renders Show example button for each of the 4 convention fields', async () => {
  render(<SettingsPage />)
  const buttons = await screen.findAllByText(/show example/i)
  expect(buttons).toHaveLength(4)
})

test('clicking Show example reveals example code and placeholder table', async () => {
  render(<SettingsPage />)
  const buttons = await screen.findAllByText(/show example/i)

  // DB read field — first button
  expect(screen.queryByText('Table name, e.g. EMPLOYEES')).not.toBeInTheDocument()
  fireEvent.click(buttons[0])
  expect(screen.getByText('Table name, e.g. EMPLOYEES')).toBeInTheDocument()
  const tables = screen.getAllByText('{table}')
  expect(tables.length).toBeGreaterThanOrEqual(2) // at least one in pre, one in table
})

test('clicking Hide example collapses the panel', async () => {
  render(<SettingsPage />)
  const showBtn = (await screen.findAllByText(/show example/i))[0]
  fireEvent.click(showBtn)
  expect(screen.getByText('Table name, e.g. EMPLOYEES')).toBeInTheDocument()

  fireEvent.click(screen.getByText(/hide example/i))
  expect(screen.queryByText('Table name, e.g. EMPLOYEES')).not.toBeInTheDocument()
})

test('each field shows its own placeholders', async () => {
  render(<SettingsPage />)
  const buttons = await screen.findAllByText(/show example/i)

  // DB write (index 1) has {$params}
  fireEvent.click(buttons[1])
  expect(screen.getAllByText('{$params}')).toHaveLength(2) // one in pre, one in table

  // Error convention (index 2) has {rtnStsField}
  fireEvent.click(buttons[2])
  expect(screen.getAllByText('{rtnStsField}').length).toBeGreaterThanOrEqual(1)

  // External call (index 3) has {name}
  fireEvent.click(buttons[3])
  const names = screen.getAllByText('{name}')
  expect(names.length).toBeGreaterThanOrEqual(1) // at least one in the external call panel
})
