import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

interface Notification {
  id: string;
  extensionId: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
  items: string[];
  _requestId?: number;
  timestamp: number;
}

export default function NotificationToast() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const handler = (_event: any, data: any) => {
      const id = `${data.extensionId}-${data._requestId || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const notification: Notification = {
        id,
        extensionId: data.extensionId,
        level: data.level || 'info',
        message: data.message,
        detail: data.detail,
        items: data.items || [],
        _requestId: data._requestId,
        timestamp: Date.now(),
      };

      setNotifications(prev => [...prev, notification]);

      // Auto-dismiss after 10s if no action buttons
      if (!notification.items.length) {
        const timer = setTimeout(() => {
          dismissNotification(id);
        }, 10000);
        timersRef.current.set(id, timer);
      }
    };

    window.ipcRenderer.on('exthost:show-notification', handler);
    return () => {
      window.ipcRenderer.removeListener('exthost:show-notification', handler);
      // Clear all timers on unmount
      for (const timer of timersRef.current.values()) clearTimeout(timer);
    };
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const handleAction = useCallback((notification: Notification, selectedItem: string | undefined) => {
    // Send response back to main process → extension host
    if (notification._requestId) {
      window.ipcRenderer.invoke(
        'exthost:notification-response',
        notification.extensionId,
        notification._requestId,
        selectedItem,
      );
    }
    dismissNotification(notification.id);
  }, [dismissNotification]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-md pointer-events-none">
      {notifications.map(n => (
        <div
          key={n.id}
          className="pointer-events-auto rounded-lg shadow-xl border animate-in slide-in-from-right"
          style={{
            backgroundColor: 'var(--bg-secondary, #1a1a24)',
            borderColor: n.level === 'error' ? '#ef4444' : n.level === 'warning' ? '#f59e0b' : 'var(--border-primary, #2a2a3a)',
            color: 'var(--text-primary, #e0e0e0)',
          }}
        >
          <div className="flex items-start gap-3 p-3">
            {/* Level icon */}
            <div className="shrink-0 mt-0.5">
              {n.level === 'error' && <AlertCircle size={18} className="text-red-400" />}
              {n.level === 'warning' && <AlertTriangle size={18} className="text-amber-400" />}
              {n.level === 'info' && <Info size={18} className="text-blue-400" />}
            </div>

            {/* Message */}
            <div className="flex-1 min-w-0">
              <div className="text-xs opacity-50 mb-0.5">{n.extensionId}</div>
              <div className="text-sm leading-snug break-words">{n.message}</div>
              {n.detail && <div className="text-xs opacity-60 mt-1 break-words">{n.detail}</div>}

              {/* Action buttons */}
              {n.items.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {n.items.map(item => (
                    <button
                      key={item}
                      onClick={() => handleAction(n, item)}
                      className="px-3 py-1 text-xs rounded font-medium transition-colors"
                      style={{
                        backgroundColor: 'var(--accent-primary, #6366f1)',
                        color: '#ffffff',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={() => handleAction(n, undefined)}
              className="shrink-0 p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
