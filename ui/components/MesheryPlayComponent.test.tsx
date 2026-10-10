import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.fn();
let mockMeshAdapters: Array<Record<string, any>> = [];

vi.mock('react-redux', () => ({
  useDispatch: () => dispatch,
  useSelector: (selector: any) => selector({ adapter: { meshAdapters: mockMeshAdapters } }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock('@/store/slices/adapter', () => ({
  setAdapter: (payload: any) => ({ type: 'adapter/setAdapter', payload }),
}));

vi.mock('@meshery/schemas/permissions', () => ({
  Keys: { InfrastructureManagementViewCloudNativeInfrastructure: 'view-infra' },
}));

vi.mock('./general/error-404/index', () => ({
  default: () => <div data-testid="default-error" />,
}));

vi.mock('./MesheryAdapterPlayComponent', () => ({
  default: ({ adapter }: any) => <div data-testid="adapter-play">{adapter.adapterLocation}</div>,
}));

vi.mock('@sistent/sistent', () => {
  const Passthrough = ({ children }: any) => <div>{children}</div>;
  return {
    Button: Passthrough,
    Divider: () => <hr />,
    MenuItem: ({ children, value }: any) => <option value={value}>{value}</option>,
    SettingsIcon: () => null,
    TextField: ({ children, value, onChange, label }: any) => (
      <select aria-label={label} value={value} onChange={onChange}>
        {children}
      </select>
    ),
    Grid2: Passthrough,
    Typography: Passthrough,
    styled: (Component: any) => () => Component,
    useTheme: () => ({ palette: { mode: 'light' }, spacing: () => 0 }),
    gray: {},
    charcoal: {},
    NoSsr: ({ children }: any) => <>{children}</>,
    useHasPermission: () => true,
  };
});

import MesheryPlayComponent from './MesheryPlayComponent';

describe('MesheryPlayComponent', () => {
  beforeEach(() => {
    dispatch.mockClear();
    mockMeshAdapters = [
      { name: 'Istio', adapterLocation: 'localhost:10000' },
      { name: 'Linkerd', adapterLocation: 'localhost:10001' },
    ];
  });

  it('renders the adapter dropdown with the first adapter selected', () => {
    render(<MesheryPlayComponent />);

    expect(screen.getByLabelText('Select Meshery Adapter')).toHaveValue('localhost:10000');
    expect(screen.getByTestId('adapter-play')).toHaveTextContent('localhost:10000');
  });

  it('switches to the adapter picked from the dropdown', () => {
    render(<MesheryPlayComponent />);

    fireEvent.change(screen.getByLabelText('Select Meshery Adapter'), {
      target: { value: 'localhost:10001' },
    });

    expect(screen.getByLabelText('Select Meshery Adapter')).toHaveValue('localhost:10001');
    expect(screen.getByTestId('adapter-play')).toHaveTextContent('localhost:10001');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'adapter/setAdapter',
      payload: { selectedAdapter: 'Linkerd' },
    });
  });

  it('shows the configure prompt when no adapters are connected', () => {
    mockMeshAdapters = [];
    render(<MesheryPlayComponent />);

    expect(screen.queryByLabelText('Select Meshery Adapter')).not.toBeInTheDocument();
    expect(screen.getByText('Adapter Unavailable')).toBeInTheDocument();
  });
});
