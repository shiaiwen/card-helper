export type ToastKind = 'success' | 'warning' | 'error';

const TOAST_HOST_ID = 'xiaochao-toast-host';
const TOAST_COLORS: Record<ToastKind, string> = {
  success: '#a9d49a',
  warning: '#f2d27a',
  error: '#f08a7a'
};

/** 屏幕顶部居中的轻提示，同一时刻可叠加多条。 */
export function showToast(message: string, kind: ToastKind = 'success', duration = 4000): void {
  if (typeof document === 'undefined' || !document.body) return;
  let host = document.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    Object.assign(host.style, {
      position: 'fixed',
      top: '64px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      pointerEvents: 'none'
    });
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    padding: '7px 14px',
    border: '1px solid rgba(242, 222, 156, .5)',
    borderRadius: '5px',
    background: 'rgba(29, 27, 24, .94)',
    boxShadow: '0 6px 18px rgba(0, 0, 0, .3)',
    color: TOAST_COLORS[kind],
    font: '13px/1.5 system-ui, sans-serif',
    whiteSpace: 'pre-line',
    textAlign: 'center'
  });
  host.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
