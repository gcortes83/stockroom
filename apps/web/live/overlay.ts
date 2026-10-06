export const overlayScript = () => {
  const KEY = 'stockroom.live.caption';
  const css = `
    #sr-live{position:fixed;left:20px;bottom:20px;z-index:2147483647;width:440px;pointer-events:none;
      font:13px/1.45 Inter Variable,system-ui,sans-serif;color:#eeedf7;border-radius:16px;padding:14px 16px;
      background:rgba(10,9,20,.92);box-shadow:0 20px 60px -20px rgba(167,139,250,.6);border:1px solid rgba(167,139,250,.45)}
    #sr-live .row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    #sr-live .id{font:600 11px JetBrains Mono Variable,monospace;color:#c4b5fd;background:rgba(167,139,250,.15);padding:2px 8px;border-radius:999px}
    #sr-live .pg{margin-left:auto;font:11px JetBrains Mono Variable,monospace;color:#a6a3c2}
    #sr-live .title{font-weight:600;font-size:15px}
    #sr-live .detail{color:#a6a3c2;margin-top:2px}
    #sr-live .status{display:inline-block;margin-top:8px;font:700 11px JetBrains Mono Variable,monospace;padding:3px 10px;border-radius:999px}
    #sr-live .running{background:rgba(251,191,36,.15);color:#fbbf24}
    #sr-live .pass{background:rgba(52,211,153,.18);color:#34d399}
    #sr-live .brand{font:600 10px JetBrains Mono Variable,monospace;letter-spacing:.12em;color:#f472b6;text-transform:uppercase}
    #sr-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;pointer-events:none;
      border:2px solid #fff;background:rgba(244,114,182,.35);box-shadow:0 0 12px rgba(244,114,182,.8);transition:transform .12s}
    .sr-ripple{position:fixed;z-index:2147483646;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;pointer-events:none;
      border:2px solid #f472b6;animation:sr-ripple .6s ease-out forwards}
    @keyframes sr-ripple{to{transform:scale(4);opacity:0}}`;
  const render = () => {
    const raw = sessionStorage.getItem(KEY);
    let box = document.getElementById('sr-live');
    if (!raw) {
      box?.remove();
      return;
    }
    const data = JSON.parse(raw) as { id: string; title: string; detail: string; status: string; progress: string };
    if (!box) {
      box = document.createElement('div');
      box.id = 'sr-live';
      document.body.appendChild(box);
    }
    box.replaceChildren();
    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.textContent = 'Claude · live test · Stockroom';
    const row = document.createElement('div');
    row.className = 'row';
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = data.id;
    const pg = document.createElement('span');
    pg.className = 'pg';
    pg.textContent = data.progress;
    row.append(id, pg);
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = data.title;
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = data.detail;
    const status = document.createElement('span');
    status.className = `status ${data.status === 'pass' ? 'pass' : 'running'}`;
    status.textContent = data.status === 'pass' ? '✓ PASS' : '● RUNNING';
    box.append(brand, row, title, detail, status);
  };
  const install = () => {
    if (!document.getElementById('sr-live-style')) {
      const style = document.createElement('style');
      style.id = 'sr-live-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    const cursor = document.createElement('div');
    cursor.id = 'sr-cursor';
    cursor.style.left = '-40px';
    cursor.style.top = '-40px';
    document.body.appendChild(cursor);
    window.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }, true);
    window.addEventListener('mousedown', (event) => {
      cursor.style.transform = 'scale(.7)';
      const ripple = document.createElement('div');
      ripple.className = 'sr-ripple';
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }, true);
    window.addEventListener('mouseup', () => (cursor.style.transform = 'scale(1)'), true);
    render();
  };
  (window as unknown as { __srRender: () => void }).__srRender = render;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
};
