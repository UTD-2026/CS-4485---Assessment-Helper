import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

/* Shared building blocks for the Night Desk UI. Styling lives in styles/App.css. */

// Icon rail + main column. items: [{ id, label, icon, count }]
export function AppShell({ label, items, active, onSelect, onLogout, children }) {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="rail-logo" aria-hidden="true">UTD</div>
        <nav className="rail-nav" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rail-item${active === item.id ? ' active' : ''}`}
              aria-current={active === item.id ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <Icon name={item.icon} size={20} strokeWidth={1.7} />
              <span className="rail-item-label">{item.label}</span>
              {item.count > 0 && (
                <span className="rail-count" aria-label={`${item.count} need attention`}>{item.count > 9 ? '9+' : item.count}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <button type="button" className="icon-button logout-button" onClick={() => setConfirmingLogout(true)} aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
      {confirmingLogout && <LogoutConfirm onYes={onLogout} onNo={() => setConfirmingLogout(false)} />}
    </div>
  );
}

function LogoutConfirm({ onYes, onNo }) {
  const noRef = useRef(null);
  useEffect(() => {
    noRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onNo(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onNo]);
  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onNo(); }}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-confirm-title">
        <div className="confirm-icon"><Icon name="logout" size={22} /></div>
        <h2 id="logout-confirm-title" className="confirm-title">Are you sure you want to log out?</h2>
        <div className="confirm-actions">
          <button type="button" className="btn btn-confirm-yes" onClick={onYes}><Icon name="check" size={16} /> Yes</button>
          <button type="button" ref={noRef} className="btn btn-confirm-no" onClick={onNo}><Icon name="x" size={16} /> No</button>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {children && <div className="page-header-meta">{children}</div>}
    </header>
  );
}

export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`badge badge-${tone} ${className}`.trim()}>{children}</span>;
}

export function Card({ title, sub, actions, children, flush, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`card${flush ? ' card-flush' : ''} ${className}`.trim()} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

const NOTICE_ICON = { warn: 'alert', bad: 'alert', good: 'checkCircle', info: 'info', lock: 'lock', clock: 'clock' };

export function Notice({ tone = 'info', icon, title, children, className = '' }) {
  return (
    <div className={`notice notice-${tone} ${className}`.trim()} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={icon || NOTICE_ICON[tone]} />
      <div>
        {title && <div className="notice-title">{title}</div>}
        {children && <div className="notice-body">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={24} />
      {title && <div className="empty-state-title">{title}</div>}
      {children && <div>{children}</div>}
    </div>
  );
}

// Progress bar. value 0-100.
export function Meter({ value = 0, tone = 'info', size = '', label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`meter${size ? ` meter-${size}` : ''}`} role="img" aria-label={label || `${Math.round(pct)}%`}>
      <span className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
