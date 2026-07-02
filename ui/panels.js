// Resizable panes, with keyboard equivalents for pointer dragging.
export function bindPanelResizing(workspace) {
  const widths = { sidebar: 210, list: 300 };
  function update(kind, requested) {
    const divider = document.getElementById(`${kind}-divider`);
    const other = kind === 'sidebar' ? widths.list : widths.sidebar;
    const maximum = Math.max(kind === 'sidebar' ? 170 : 240,
      Math.min(kind === 'sidebar' ? 340 : 460, workspace.clientWidth - other - 370));
    const next = Math.round(Math.min(maximum, Math.max(kind === 'sidebar' ? 170 : 240, requested)));
    widths[kind] = next;
    workspace.style.setProperty(`--${kind}-width`, `${next}px`);
    divider.setAttribute('aria-valuenow', String(next));
    divider.setAttribute('aria-valuemax', String(Math.round(maximum)));
  }
  for (const kind of ['sidebar', 'list']) {
    const divider = document.getElementById(`${kind}-divider`);
    let drag = null;
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = { start: event.clientX, width: widths[kind] };
      divider.setPointerCapture(event.pointerId);
      workspace.classList.add('resizing'); event.preventDefault();
    });
    divider.addEventListener('pointermove', event => {
      if (drag) update(kind, drag.width + event.clientX - drag.start);
    });
    const end = () => { drag = null; workspace.classList.remove('resizing'); };
    divider.addEventListener('pointerup', end);
    divider.addEventListener('lostpointercapture', end);
    divider.addEventListener('pointercancel', end);
    divider.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        update(kind, widths[kind] + (event.key === 'ArrowRight' ? 10 : -10)); event.preventDefault();
      }
    });
  }
  new ResizeObserver(() => { if (workspace.clientWidth < 600) return; update('sidebar', widths.sidebar); update('list', widths.list); }).observe(workspace);
}
