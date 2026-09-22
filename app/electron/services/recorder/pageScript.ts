/**
 * Injected into every page/frame of a recording session via
 * BrowserContext.addInitScript(). Runs inside the recorded page's own JS
 * realm (not Node), so it is intentionally plain, dependency-free JS
 * authored as a string rather than a typed module — see recorderService.ts.
 *
 * It computes a best-effort locator for the element a user interacts with,
 * preferring the same strategy order the Element Inspector promises
 * (role/testId/label/placeholder over CSS) — see docs/TEST_MODEL.md — and
 * reports each interaction back to the main process via the
 * `__aasRecordEvent` binding exposed by recorderService.ts. It never reads
 * or sends the value of a password field.
 */
export const RECORDER_INIT_SCRIPT = `
(() => {
  if (window.__aasRecorderInstalled) return;
  window.__aasRecorderInstalled = true;

  function attrTestId(el) {
    return el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || el.getAttribute('data-qa');
  }

  function labelForInput(el) {
    if (el.id) {
      try {
        const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl && lbl.textContent) return lbl.textContent.trim();
      } catch (e) {}
    }
    const wrapLabel = el.closest('label');
    if (wrapLabel && wrapLabel.textContent) return wrapLabel.textContent.trim();
    return null;
  }

  function shortCssPath(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
        parts.unshift(part);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function roleForElement(el) {
    const tag = el.tagName.toLowerCase();
    const explicitRole = el.getAttribute('role');
    if (explicitRole) return explicitRole;
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    return null;
  }

  function computeLocator(el) {
    const testId = attrTestId(el);
    if (testId) return { strategy: 'testId', value: testId, quality: 'excellent' };

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return { strategy: 'label', value: ariaLabel.trim(), quality: 'excellent' };

    const label = labelForInput(el);
    if (label) return { strategy: 'label', value: label, quality: 'good' };

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return { strategy: 'placeholder', value: placeholder.trim(), quality: 'good' };

    const role = roleForElement(el);
    const text = ((el.innerText || el.value || '') + '').trim().slice(0, 80);
    if (role && text) return { strategy: 'role', value: role, roleName: text, quality: 'good' };
    if (role) return { strategy: 'role', value: role, quality: 'fair' };

    if (el.id) return { strategy: 'css', value: '#' + el.id, quality: 'fair' };

    return { strategy: 'css', value: shortCssPath(el), quality: 'fragile' };
  }

  function send(action) {
    if (window.__aasRecordEvent) window.__aasRecordEvent(action);
  }

  function isClickTarget(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return true;
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return ['submit', 'button', 'reset', 'image'].indexOf(type) !== -1;
    }
    const role = el.getAttribute('role');
    return ['button', 'link', 'tab', 'menuitem'].indexOf(role || '') !== -1;
  }

  document.addEventListener('click', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('button, a, input, [role]') : null;
    if (!el || !isClickTarget(el)) return;
    send({ kind: 'click', locator: computeLocator(el) });
  }, true);

  document.addEventListener('dblclick', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('button, a, input, [role]') : null;
    if (!el || !isClickTarget(el)) return;
    send({ kind: 'dblclick', locator: computeLocator(el) });
  }, true);

  document.addEventListener('change', function (ev) {
    const el = ev.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      send({ kind: 'select', locator: computeLocator(el), value: el.value });
      return;
    }
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        send({ kind: el.checked ? 'check' : 'uncheck', locator: computeLocator(el) });
        return;
      }
      if (type === 'password') {
        send({ kind: 'fill', locator: computeLocator(el), isPassword: true });
        return;
      }
      if (['submit', 'button', 'reset', 'image', 'file'].indexOf(type) !== -1) return;
      send({ kind: 'fill', locator: computeLocator(el), value: el.value });
      return;
    }
    if (tag === 'textarea') {
      send({ kind: 'fill', locator: computeLocator(el), value: el.value });
    }
  }, true);
})();
`;
