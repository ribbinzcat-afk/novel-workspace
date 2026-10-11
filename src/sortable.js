// deps = 0. Tiny drag-to-reorder helper that works with mouse AND touch (pointer events).
// The dragged element is moved live in the DOM, so no ghost/placeholder is needed.

/**
 * @param {HTMLElement} container element that holds the items
 * @param {object} opts
 * @param {string} opts.item       selector of a sortable item (direct children of container)
 * @param {string} opts.handle     selector of the drag handle inside an item
 * @param {boolean} [opts.grid]    items flow in rows (decide before/after by X), else a vertical list
 * @param {(from:number, to:number) => void} opts.onEnd called once when the drop changed the order
 */
export function makeSortable(container, { item, handle, grid = false, onEnd }) {
    if (!container || container.dataset.novelwsSortable) return;
    container.dataset.novelwsSortable = '1';

    let drag = null; // { el, from, startX, startY, started, pointerId, scroller }

    const items = () => Array.from(container.querySelectorAll(`:scope > ${item}`));

    const scrollParent = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
        }
        return null;
    };

    container.addEventListener('pointerdown', (ev) => {
        const h = /** @type {HTMLElement} */ (ev.target).closest(handle);
        if (!h || !container.contains(h)) return;
        const el = h.closest(item);
        if (!el || el.parentElement !== container) return;
        if (ev.button !== undefined && ev.button !== 0) return;
        ev.preventDefault();
        drag = {
            el,
            from: items().indexOf(el),
            startX: ev.clientX,
            startY: ev.clientY,
            started: false,
            pointerId: ev.pointerId,
            scroller: scrollParent(container),
        };
        try { h.setPointerCapture(ev.pointerId); } catch { /* old browsers */ }
    });

    container.addEventListener('pointermove', (ev) => {
        if (!drag || ev.pointerId !== drag.pointerId) return;
        if (!drag.started) {
            if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 5) return;
            drag.started = true;
            drag.el.classList.add('novelws-dragging');
            container.classList.add('novelws-sorting');
        }
        ev.preventDefault();

        // Auto-scroll near the edges of the scrolling parent.
        const sc = drag.scroller;
        if (sc) {
            const r = sc.getBoundingClientRect();
            if (ev.clientY < r.top + 40) sc.scrollTop -= 12;
            else if (ev.clientY > r.bottom - 40) sc.scrollTop += 12;
        }

        const target = items().find(x => {
            if (x === drag.el) return false;
            const r = x.getBoundingClientRect();
            return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        });
        if (!target) return;
        const r = target.getBoundingClientRect();
        const after = grid
            ? (ev.clientX > r.left + r.width / 2)
            : (ev.clientY > r.top + r.height / 2);
        container.insertBefore(drag.el, after ? target.nextElementSibling : target);
    });

    const finish = (ev) => {
        if (!drag || (ev && ev.pointerId !== drag.pointerId)) return;
        const d = drag;
        drag = null;
        d.el.classList.remove('novelws-dragging');
        container.classList.remove('novelws-sorting');
        if (!d.started) return;
        container.dataset.novelwsJustDragged = '1';
        setTimeout(() => { delete container.dataset.novelwsJustDragged; }, 0);
        const to = items().indexOf(d.el);
        if (to !== d.from && to >= 0) onEnd(d.from, to);
    };
    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);
    // A click fires after a real drag; swallow it so the row is not also "selected".
    container.addEventListener('click', (ev) => {
        if (container.dataset.novelwsJustDragged) {
            ev.stopPropagation();
            ev.preventDefault();
        }
    }, true);
}
