/* NSV runtime: chạy các trang mẫu (.dc) như website tĩnh. Không cần máy chủ. */
(function () {
  'use strict';
  var app = null, renderQueued = false, tpl = null, host = null;

  class DCLogic {
    constructor(props) { this.props = props || {}; }
    setState(o) {
      Object.assign(this.state || (this.state = {}), o);
      if (app) schedule();
    }
  }

  function schedule() {
    if (renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(function () { renderQueued = false; render(); });
  }

  /* ---------- lookup ---------- */
  var SINGLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var ANY = /\{\{\s*([^}]+?)\s*\}\}/g;
  function look(expr, scope, vals) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    var parts = expr.split('.');
    var cur = (parts[0] in scope) ? scope[parts[0]] : vals[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (cur == null) return '';
      cur = cur[parts[i]];
    }
    return cur == null ? '' : cur;
  }
  function subst(str, scope, vals) {
    return str.replace(ANY, function (m, e) {
      var v = look(e, scope, vals);
      return typeof v === 'function' ? '' : String(v);
    });
  }

  /* ---------- build new tree ---------- */
  var BOOL = { checked: 1, disabled: 1, selected: 1, hidden: 1, required: 1, readonly: 1 };

  function build(node, scope, vals, out) {
    if (node.nodeType === 3) {
      out.appendChild(document.createTextNode(subst(node.data, scope, vals)));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-for') {
      var lm = SINGLE.exec(node.getAttribute('list') || '');
      var list = lm ? look(lm[1], scope, vals) : [];
      var name = node.getAttribute('as') || 'item';
      if (!Array.isArray(list)) list = [];
      for (var i = 0; i < list.length; i++) {
        var sc = Object.create(scope); sc[name] = list[i];
        kids(node, sc, vals, out);
      }
      return;
    }
    if (tag === 'sc-if') {
      var im = SINGLE.exec(node.getAttribute('value') || '');
      if (im && look(im[1], scope, vals)) kids(node, scope, vals, out);
      return;
    }
    var el = document.createElementNS(node.namespaceURI, node.localName);
    el.__on = {};
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], n = at.name, raw = at.value;
      if (n.indexOf('hint-placeholder') === 0) continue;
      var sm = SINGLE.exec(raw);
      var low = n.toLowerCase();
      if (low.length > 2 && low.indexOf('on') === 0 && sm) {
        var fn = look(sm[1], scope, vals);
        if (typeof fn === 'function') el.__on[low.slice(2)] = fn;
        continue;
      }
      var v = sm ? look(sm[1], scope, vals) : subst(raw, scope, vals);
      if (low === 'value' && /^(input|textarea|select)$/.test(tag)) { el.__value = String(v); continue; }
      if (BOOL[low]) { el.__bool = el.__bool || {}; el.__bool[low] = !!v && v !== 'false'; continue; }
      if (typeof v === 'function') continue;
      el.setAttribute(n, String(v));
    }
    kids(node, scope, vals, el);
    finalize(el);
    out.appendChild(el);
  }
  function kids(node, scope, vals, out) {
    for (var c = node.firstChild; c; c = c.nextSibling) build(c, scope, vals, out);
  }
  function finalize(el) {
    if (el.__value !== undefined) el.value = el.__value;
    if (el.__bool) for (var k in el.__bool) { try { el[k] = el.__bool[k]; } catch (e) {} }
  }

  /* ---------- morph (giữ nguyên focus, vị trí cuộn, nội dung đang gõ) ---------- */
  function morphKids(o, n) {
    var oc = Array.prototype.slice.call(o.childNodes);
    var nc = Array.prototype.slice.call(n.childNodes);
    for (var i = 0; i < nc.length; i++) {
      if (i >= oc.length) o.appendChild(nc[i]);
      else patch(oc[i], nc[i]);
    }
    for (var j = oc.length - 1; j >= nc.length; j--) o.removeChild(oc[j]);
  }
  function patch(o, n) {
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { o.parentNode.replaceChild(n, o); return; }
    if (n.nodeType === 3) { if (o.data !== n.data) o.data = n.data; return; }
    var i, at;
    for (i = o.attributes.length - 1; i >= 0; i--) {
      at = o.attributes[i];
      if (!n.hasAttribute(at.name)) o.removeAttribute(at.name);
    }
    for (i = 0; i < n.attributes.length; i++) {
      at = n.attributes[i];
      if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
    }
    o.__on = n.__on;
    morphKids(o, n);
    if (n.__value !== undefined && o.value !== n.__value && o !== document.activeElement && o.type !== 'file') o.value = n.__value;
    if (n.__bool) for (var k in n.__bool) { try { if (o[k] !== n.__bool[k]) o[k] = n.__bool[k]; } catch (e) {} }
  }

  function render() {
    var vals = app.renderVals();
    var out = document.createDocumentFragment();
    kids(tpl, Object.create(null), vals, out);
    morphKids(host, out);
  }

  /* ---------- events ---------- */
  function textLike(t) {
    if (t.tagName === 'TEXTAREA') return true;
    if (t.tagName !== 'INPUT') return false;
    return !/^(checkbox|radio|file|date|time|range|color|button|submit)$/.test(t.type);
  }
  function dispatch(kind, e) {
    for (var t = e.target; t && t !== host.parentNode; t = t.parentNode) {
      if (t.__on && t.__on[kind]) { t.__on[kind].call(t, e); return true; }
    }
    return false;
  }
  function wire() {
    host.addEventListener('click', function (e) { dispatch('click', e); });
    host.addEventListener('input', function (e) { if (textLike(e.target)) dispatch('change', e); });
    host.addEventListener('change', function (e) { if (!textLike(e.target)) dispatch('change', e); });
  }

  /* ---------- boot ---------- */
  function boot() {
    host = document.querySelector('x-dc');
    var sc = document.querySelector('script[type="text/x-dc"]');
    if (!host || !sc) return;
    var helmet = host.querySelector('helmet');
    if (helmet) {
      while (helmet.firstChild) {
        var ch = helmet.firstChild; helmet.removeChild(ch);
        if (ch.nodeType === 1) document.head.appendChild(ch);
      }
      helmet.parentNode.removeChild(helmet);
    }
    tpl = host.cloneNode(true);
    while (host.firstChild) host.removeChild(host.firstChild);
    host.style.display = 'block';
    var Cls = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    var inst = new Cls({});
    if (!inst.state) inst.state = {};
    app = inst;
    wire();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
