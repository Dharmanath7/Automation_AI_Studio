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

  // ---- Visual "what's being recorded" feedback ---------------------------
  // A short-lived highlight box + label over the element just acted on, so
  // the person recording can see in real time that the click/hover/fill
  // they just did was actually captured (and on what element) — not just a
  // silent step count ticking up somewhere else in the Studio window.
  var ACTION_LABELS = { click: 'Click', dblclick: 'Double-click', hover: 'Hover', fill: 'Fill', select: 'Select', check: 'Check', uncheck: 'Uncheck' };
  function flashHighlight(el, kind) {
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      var box = document.createElement('div');
      box.setAttribute('data-aas-recorder-overlay', '1');
      box.style.cssText = [
        'position:fixed', 'left:' + rect.left + 'px', 'top:' + rect.top + 'px',
        'width:' + rect.width + 'px', 'height:' + rect.height + 'px',
        'border:2px solid #5b5ff5', 'border-radius:4px',
        'background:rgba(91,95,245,0.12)', 'box-shadow:0 0 0 3px rgba(91,95,245,0.25)',
        'pointer-events:none', 'z-index:2147483647', 'transition:opacity 300ms ease',
      ].join(';');
      var label = document.createElement('div');
      label.textContent = ACTION_LABELS[kind] || kind;
      label.style.cssText = [
        'position:fixed', 'left:' + rect.left + 'px', 'top:' + (Math.max(0, rect.top - 22)) + 'px',
        'background:#5b5ff5', 'color:#fff', 'font:700 11px -apple-system,Segoe UI,Arial,sans-serif',
        'padding:2px 7px', 'border-radius:4px', 'pointer-events:none', 'z-index:2147483647',
        'transition:opacity 300ms ease',
      ].join(';');
      document.body.appendChild(box);
      document.body.appendChild(label);
      setTimeout(function () {
        box.style.opacity = '0';
        label.style.opacity = '0';
        setTimeout(function () {
          if (box.parentNode) box.parentNode.removeChild(box);
          if (label.parentNode) label.parentNode.removeChild(label);
        }, 320);
      }, 500);
    } catch (e) {
      // Never let the visual feedback layer break recording itself.
    }
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
    flashHighlight(el, 'click');
    send({ kind: 'click', locator: computeLocator(el) });
  }, true);

  document.addEventListener('dblclick', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('button, a, input, [role]') : null;
    if (!el || !isClickTarget(el)) return;
    flashHighlight(el, 'dblclick');
    send({ kind: 'dblclick', locator: computeLocator(el) });
  }, true);

  document.addEventListener('change', function (ev) {
    const el = ev.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      flashHighlight(el, 'select');
      send({ kind: 'select', locator: computeLocator(el), value: el.value });
      return;
    }
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        flashHighlight(el, el.checked ? 'check' : 'uncheck');
        send({ kind: el.checked ? 'check' : 'uncheck', locator: computeLocator(el) });
        return;
      }
      if (type === 'password') {
        flashHighlight(el, 'fill');
        send({ kind: 'fill', locator: computeLocator(el), isPassword: true });
        return;
      }
      if (['submit', 'button', 'reset', 'image', 'file'].indexOf(type) !== -1) return;
      flashHighlight(el, 'fill');
      send({ kind: 'fill', locator: computeLocator(el), value: el.value });
      return;
    }
    if (tag === 'textarea') {
      flashHighlight(el, 'fill');
      send({ kind: 'fill', locator: computeLocator(el), value: el.value });
    }
  }, true);

  // ---- Hover recording (dwell-based) --------------------------------
  // Recording a "hover" on every mouseover would fire constantly as the
  // cursor merely crosses the page — instead only record it once the
  // pointer has actually rested over a plausibly-deliberate target for long
  // enough (e.g. opening a dropdown/menu), and only once per dwell.
  //
  // "Plausibly deliberate" is NOT limited to a fixed tag whitelist (button/
  // a/li/[role]) — most real hover-reveal UI (cards, custom dropdowns,
  // tooltips) is a plain <div>/<span> whose reveal is driven by a
  // 'SELECTOR:hover { ... }' CSS rule, e.g. '.figure:hover .figcaption'.
  // hasHoverStyleRule() scans the page's own stylesheets for such rules and
  // tests the element against the compound the ":hover" is actually
  // attached to, so any element the page itself treats as hoverable is
  // caught, not just ones authored with semantic HTML.
  var HOVER_DWELL_MS = 500;
  var hoverTimer = null;
  var hoverTarget = null;
  var hoverCompoundsCache = null;
  var hoverCompoundsCacheAt = 0;

  function getHoverCompounds() {
    var now = Date.now();
    if (hoverCompoundsCache && (now - hoverCompoundsCacheAt) < 1000) return hoverCompoundsCache;
    var compounds = [];
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var rules;
        try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          if (!rule.selectorText || rule.selectorText.indexOf(':hover') === -1) continue;
          var parts = rule.selectorText.split(',');
          for (var p = 0; p < parts.length; p++) {
            var tokens = parts[p].trim().split(/\\s+/);
            for (var t = 0; t < tokens.length; t++) {
              if (tokens[t].indexOf(':hover') !== -1) {
                var compound = tokens[t].replace(/:hover/g, '');
                if (compound) compounds.push(compound);
              }
            }
          }
        }
      }
    } catch (e) {}
    hoverCompoundsCache = compounds;
    hoverCompoundsCacheAt = now;
    return compounds;
  }

  function hasHoverStyleRule(el) {
    var compounds = getHoverCompounds();
    for (var i = 0; i < compounds.length; i++) {
      try { if (el.matches(compounds[i])) return true; } catch (e) {}
    }
    return false;
  }

  function isHoverTarget(el) {
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return false;
    if (isClickTarget(el)) return true;
    var role = el.getAttribute('role');
    if (['menu', 'menuitem', 'tab', 'tooltip', 'option'].indexOf(role || '') !== -1) return true;
    if (el.getAttribute('data-hover')) return true;
    if (el.querySelector(':scope > .dropdown-menu, :scope > [role="menu"]')) return true;
    try { if (getComputedStyle(el).cursor === 'pointer') return true; } catch (e) {}
    if (hasHoverStyleRule(el)) return true;
    return false;
  }

  document.addEventListener('mouseover', function (ev) {
    var el = ev.target;
    var depth = 0;
    while (el && el.nodeType === 1 && depth < 8 && !isHoverTarget(el)) {
      el = el.parentElement;
      depth++;
    }
    if (!el || el.nodeType !== 1 || !isHoverTarget(el) || el === hoverTarget) return;
    hoverTarget = el;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      if (hoverTarget !== el) return;
      flashHighlight(el, 'hover');
      send({ kind: 'hover', locator: computeLocator(el) });
    }, HOVER_DWELL_MS);
  }, true);

  document.addEventListener('mouseout', function (ev) {
    if (!hoverTarget) return;
    var related = ev.relatedTarget;
    if (related && hoverTarget.contains && hoverTarget.contains(related)) return;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hoverTarget = null;
  }, true);
})();
`;
