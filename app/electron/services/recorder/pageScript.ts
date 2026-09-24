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

  function buildCssPath(el, maxDepth) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < maxDepth) {
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

  // A 4-level path like "div > table > tbody > tr:nth-of-type(2)" is only
  // unique relative to ITS OWN ancestor chain — on a page with more than one
  // matching table/list structure (a very common layout), the exact same
  // path also matches the Nth row of every other such structure, and
  // Playwright's actions refuse to run against a locator matching more than
  // one element ("strict mode violation") no matter how long they wait, so
  // no amount of extra timeout fixes it. Grow the path deeper, level by
  // level, until it's actually unique on the page (or give up at a generous
  // depth and return the deepest attempt as a last resort).
  function shortCssPath(el) {
    let lastPath = '';
    for (let maxDepth = 4; maxDepth <= 12; maxDepth++) {
      const path = buildCssPath(el, maxDepth);
      lastPath = path;
      try {
        if (document.querySelectorAll(path).length === 1) return path;
      } catch (e) {
        break;
      }
    }
    return lastPath;
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

  // Any real interaction — not just ones that themselves get recorded as a
  // "click" step — should suppress a pending hover on that same element.
  // Clicking into a plain text field to focus it before typing/filling is
  // the clearest case: it's not a recorded click action at all (isClickTarget()
  // deliberately excludes plain text inputs below), so the 'click' listener's
  // own suppression call never runs for it, leaving that field's dwell timer
  // or pending hover emission free to fire later on its own — caught live as
  // a spurious hover recorded on a field immediately before filling it.
  // mousedown (not click) so it also runs ahead of whatever the click
  // handler does, on every element unconditionally.
  document.addEventListener('mousedown', function (ev) {
    if (ev.target) cancelPendingHoverIfSameElement(ev.target);
  }, true);

  document.addEventListener('click', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('button, a, input, [role]') : null;
    if (!el || !isClickTarget(el)) return;
    cancelPendingHoverIfSameElement(el);
    flashHighlight(el, 'click');
    send({ kind: 'click', locator: computeLocator(el) });
  }, true);

  document.addEventListener('dblclick', function (ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('button, a, input, [role]') : null;
    if (!el || !isClickTarget(el)) return;
    cancelPendingHoverIfSameElement(el);
    flashHighlight(el, 'dblclick');
    send({ kind: 'dblclick', locator: computeLocator(el) });
  }, true);

  document.addEventListener('change', function (ev) {
    const el = ev.target;
    if (!el || !el.tagName) return;
    cancelPendingHoverIfSameElement(el);
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

  // ---- Recorder-toolbar "Insert Random Value" -----------------------
  // Invoked from the main process (see recorderService.ts's
  // insertRandomValue()) when the person recording clicks "Insert Random
  // Value" in the small companion toolbar window instead of typing a real
  // value into the currently-focused field. Fills it with a garbage-looking
  // preview value so it's visible immediately, but records the STEP as a
  // random-value fill (isRandom: true) rather than that literal — the
  // generated test then calls random_data.random_string() at run time, a
  // fresh value every run, same as toggling a fill step to "random" by hand
  // in the Test Editor.
  function setNativeValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    var setter = desc && desc.set;
    if (setter) { setter.call(el, value); } else { el.value = value; }
    // 'input' only (not 'change') — frameworks that track value via the
    // native setter need this to register it, and our own recorder listens
    // for 'change' to capture fills, which would double-record this as a
    // second, literal fill step if we dispatched it too.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  window.__aasInsertRandomValue = function () {
    var el = document.activeElement;
    if (!el || !el.tagName) return { ok: false, reason: 'No field is focused — click into a text field first.' };
    var tag = el.tagName.toLowerCase();
    var isTextInput =
      tag === 'textarea' ||
      (tag === 'input' && ['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'password'].indexOf((el.getAttribute('type') || 'text').toLowerCase()) === -1);
    if (!isTextInput) return { ok: false, reason: 'The focused element is not a text field.' };

    cancelPendingHoverIfSameElement(el);

    // Format mirrors random_string() in the generated utils/random_data.py
    // and generateRandomValue()'s "randomString" case — letters plus a
    // millisecond-timestamp fragment, so this preview alone is already
    // collision-proof across repeated recordings, not just "very probably"
    // unique.
    var letters = '';
    var letterCount = 6 + Math.floor(Math.random() * 5);
    for (var i = 0; i < letterCount; i++) letters += String.fromCharCode(97 + Math.floor(Math.random() * 26));
    var previewValue = letters + String(Date.now()).slice(-8);

    setNativeValue(el, previewValue);
    flashHighlight(el, 'fill');
    send({ kind: 'fill', locator: computeLocator(el), value: previewValue, isRandom: true });
    return { ok: true };
  };

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

  var NON_HOVERABLE_TAGS = ['html', 'body', 'script', 'style', 'head', 'meta', 'link', 'br', 'wbr', 'title'];

  function isHoverTarget(el) {
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return false;
    if (NON_HOVERABLE_TAGS.indexOf(el.tagName.toLowerCase()) !== -1) return false;
    if (isClickTarget(el)) return true;
    var role = el.getAttribute('role');
    if (['menu', 'menuitem', 'tab', 'tooltip', 'option'].indexOf(role || '') !== -1) return true;
    if (el.getAttribute('data-hover')) return true;
    if (el.querySelector(':scope > .dropdown-menu, :scope > [role="menu"]')) return true;
    try { if (getComputedStyle(el).cursor === 'pointer') return true; } catch (e) {}
    if (hasHoverStyleRule(el)) return true;
    // Fallback: any other bounded, non-page-sized element the pointer
    // rests on is still plausibly a deliberate hover target. Most React
    // (and similar) apps implement hover-reveal menus/tooltips purely via
    // onMouseEnter-style JS handlers with no CSS :hover rule and no
    // cursor:pointer at all — and React's synthetic event system delegates
    // listeners at the app root rather than attaching them to the element
    // itself, so "does this element have a hover handler" genuinely can't
    // be observed from outside React. Without this fallback, that entire
    // (very common) category of hover-driven UI is invisible to the
    // recorder no matter how long the dwell. mouseoverToClickSuppresses()
    // below keeps this from turning every "move toward a button, pause,
    // then click it" into a spurious extra hover step.
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      var coversViewport = rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9;
      return !coversViewport;
    } catch (e) {
      return false;
    }
  }

  // A hover immediately followed by a click/fill/etc. on the SAME element
  // is almost always just the natural "move the mouse toward what you're
  // about to interact with, pausing briefly on the way" — not a deliberate
  // hover-to-reveal action — now that isHoverTarget() above accepts nearly
  // any element as a candidate rather than only ones with an explicit
  // hover signal. Recording it as a separate "hover" step ahead of the
  // real action would just be noise the person has to delete by hand. The
  // hover's own recording is delayed by this buffer so it can be silently
  // dropped if a real action on the same element follows within it; the
  // visual highlight still fires immediately at dwell-time regardless, so
  // recording still *feels* instant.
  var HOVER_EMIT_BUFFER_MS = 450;
  var pendingHoverEl = null;
  var pendingHoverTimer = null;

  function sameOrRelated(a, b) {
    if (!a || !b) return false;
    return a === b || (a.contains && a.contains(b)) || (b.contains && b.contains(a));
  }

  function cancelPendingHoverIfSameElement(el) {
    // Two separate pieces of state can be in flight when a real action
    // lands on the element the pointer is sitting on: the pre-dwell timer
    // (mouse hasn't rested long enough yet to even be a hover candidate)
    // and the post-dwell pending emission (dwell fired, still inside the
    // emit buffer). A click can land during EITHER window — Playwright's
    // own click, and most real users, act on an element well under 500ms
    // after the pointer reaches it — so both must be cleared, or the
    // pre-dwell timer just fires later on its own and records a hover for
    // an interaction that already resolved as a click.
    if (sameOrRelated(el, hoverTarget)) {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = null;
      hoverTarget = null;
    }
    if (sameOrRelated(el, pendingHoverEl)) {
      if (pendingHoverTimer) clearTimeout(pendingHoverTimer);
      pendingHoverEl = null;
      pendingHoverTimer = null;
    }
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
      if (pendingHoverTimer) clearTimeout(pendingHoverTimer);
      pendingHoverEl = el;
      pendingHoverTimer = setTimeout(function () {
        if (pendingHoverEl !== el) return;
        pendingHoverEl = null;
        pendingHoverTimer = null;
        send({ kind: 'hover', locator: computeLocator(el) });
      }, HOVER_EMIT_BUFFER_MS);
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
