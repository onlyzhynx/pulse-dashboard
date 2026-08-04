import { useTheme } from '../../context/ThemeContext'

export default function Widget({ title, subtitle, children, actions, noPad = false }) {
  const { theme } = useTheme()
  return (
    <div className="widget-card">
      <div className="widget-header">
        <div>
          <div className="widget-title">{title}</div>
          {subtitle && (
            <div className="blur-value" style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{actions}</div>}
      </div>
      <div className="widget-body" style={noPad ? { padding: 0 } : {}}>
        {children}
      </div>
    </div>
  )
}
