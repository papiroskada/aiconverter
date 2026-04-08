import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import OverviewTab from '../../src/components/Panel/OverviewTab.jsx'

const makeAnalysis = (overrides = {}) => ({
  business_purpose: 'Manages user record lifecycle for the HR system.',
  input_contract: JSON.stringify([
    { name: 'userInfo', cobolName: 'WGET-USR-INFO', type: 'object', direction: 'in', description: 'User data to process' },
  ]),
  output_contract: JSON.stringify([
    { name: 'result', cobolName: 'WGET-RESULT', type: 'string', direction: 'out', description: 'Operation result code' },
  ]),
  ...overrides,
})

describe('OverviewTab', () => {
  it('shows no analysis message when analysis is null', () => {
    render(<OverviewTab analysis={null} />)
    expect(screen.getByText('No analysis yet.')).toBeTruthy()
  })

  it('renders business_purpose', () => {
    render(<OverviewTab analysis={makeAnalysis()} />)
    expect(screen.getByText('Manages user record lifecycle for the HR system.')).toBeTruthy()
  })

  it('renders input parameter name and type', () => {
    render(<OverviewTab analysis={makeAnalysis()} />)
    expect(screen.getByText('userInfo')).toBeTruthy()
    expect(screen.getByText('object')).toBeTruthy()
  })

  it('renders input parameter cobolName', () => {
    render(<OverviewTab analysis={makeAnalysis()} />)
    expect(screen.getByText('WGET-USR-INFO')).toBeTruthy()
  })

  it('renders input parameter description', () => {
    render(<OverviewTab analysis={makeAnalysis()} />)
    expect(screen.getByText('User data to process')).toBeTruthy()
  })

  it('renders output parameter name', () => {
    render(<OverviewTab analysis={makeAnalysis()} />)
    expect(screen.getByText('result')).toBeTruthy()
  })

  it('renders nothing extra when business_purpose is absent', () => {
    const analysisNoPurposeNoDesc = {
      business_purpose: null,
      input_contract: JSON.stringify([{ name: 'x', cobolName: 'X', type: 'string', direction: 'in' }]),
      output_contract: JSON.stringify([]),
    }
    const { container } = render(<OverviewTab analysis={analysisNoPurposeNoDesc} />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders nothing for unparseable input_contract', () => {
    render(<OverviewTab analysis={makeAnalysis({ input_contract: 'not json' })} />)
    expect(screen.queryByText('Input Parameters')).toBeNull()
  })
})
