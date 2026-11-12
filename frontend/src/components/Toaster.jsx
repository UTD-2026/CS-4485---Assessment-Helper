import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { subscribe } from '../utils/toast.js';

const ICON = { good: 'checkCircle', bad: 'alert', info: 'info' };

// Renders toasts from utils/toast.js in the bottom-right corner (polite live region).
export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => subscribe((item) => {
    setItems((list) => [...list.slice(-3), item]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== item.id)), item.duration || 4500);
  }), []);

  const dismiss = (id) => setItems((list) => list.filter((t) => t.id !== id));

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <Icon name={ICON[t.tone] || 'info'} />
          {t.onClick ? (
            <button type="button" className="toast-body btn-reset toast-action" onClick={() => { t.onClick(); dismiss(t.id); }}>
              {t.title && <strong className="toast-title">{t.title} </strong>}{t.message}
            </button>
          ) : (
            <div className="toast-body">{t.title && <strong>{t.title} </strong>}{t.message}</div>
          )}
          <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
        </div>
      ))}
    </div>
  );
}
