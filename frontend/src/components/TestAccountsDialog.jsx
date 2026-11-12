import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import Icon from './Icon.jsx';
import { Badge } from './ui.jsx';

/**
 * Login page "Need more test accounts?" list: every professor in the database with their
 * username (NetID) and whether they are a committee (AC) member or a professor.
 * Data: GET /api/auth/test-accounts (development only; the backend turns it off in production).
 * Clicking a username fills it into the sign-in form.
 */
export default function TestAccountsDialog({ onClose, onPick }) {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const searchRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.testAccounts()
      .then((res) => { if (!cancelled) setAccounts(res.data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    searchRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts || []).filter((a) =>
      (role === 'all' || a.role === role) &&
      (!q || a.netid.includes(q) || a.name.toLowerCase().includes(q) || String(a.department || '').toLowerCase().includes(q)));
  }, [accounts, query, role]);

  const committeeCount = (accounts || []).filter((a) => a.role === 'Committee').length;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="test-accounts-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2 id="test-accounts-title" className="card-title">Test accounts</h2>
            <p className="card-sub">
              {accounts ? `${accounts.length} accounts · ${committeeCount} committee · ${accounts.length - committeeCount} professors · ` : ''}
              Password for all: <span className="mono">123</span>
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="dialog-filters">
          <input ref={searchRef} className="input" type="search" placeholder="Search by username, name or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search accounts" />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
            <option value="all">All roles</option>
            <option value="Committee">Committee</option>
            <option value="Professor">Professor</option>
          </select>
        </div>

        <div className="dialog-body">
          {error ? <p className="empty-cell text-bad">Could not load accounts: {error}</p>
            : !accounts ? <p className="empty-cell muted">Loading accounts…</p>
            : (
              <table className="data-table">
                <thead><tr><th>Username</th><th>Name</th><th>Dept</th><th>Role</th></tr></thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan="4" className="empty-cell">No accounts match.</td></tr>}
                  {shown.map((a) => (
                    <tr key={a.netid}>
                      <td><button type="button" className="btn-link mono" onClick={() => onPick(a.netid)} title="Use this username">{a.netid}</button></td>
                      <td className="strong">{a.name}</td>
                      <td>{a.department}</td>
                      <td><Badge tone={a.role === 'Committee' ? 'warn' : 'neutral'}>{a.role}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <p className="dialog-foot">Click a username to fill it in.</p>
      </div>
    </div>
  );
}
