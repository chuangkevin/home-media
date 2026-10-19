/**
 * duo-hinge.js — 全域轉軸偵測腳本（系統層）
 *
 * 在你自己的部署層（nginx / index.html）為「所有專案」注入這支腳本，
 * 它會量測 Surface Duo 展開時的實際分段（CSS `env(viewport-segment-*)`），
 * 偵測不到時以 Duo 尺寸判斷備援，然後把轉軸資訊寫到 <html> 的 data
 * 屬性與 CSS 變數，任何 app 依約定取用即可避免內容與中軸重疊。
 *
 * 設定（<html data-duo-spanned='true'> 時）：
 *   data-duo-hinge-axis  = 'y'（橫展開，轉軸垂直）| 'x'（直展開，轉軸水平）
 *   --duo-hinge-start    = 轉軸起點（px，自視口左/上緣）
 *   --duo-hinge-size     = 轉軸寬度（px）
 *   --duo-hinge-pane     = 單一螢幕寬（px）
 * 事件：window 'duohingechange'（detail = { spanned, axis, start, size, pane }）
 *
 * nginx 全域注入範例：
 *   sub_filter_once on;
 *   sub_filter '</head>' '<script src="/__duo/duo-hinge.js" defer></script></head>';
 *   location /__duo/ { alias /srv/duo-hinge/; }
 * （或直接在每個專案 index.html 的 </head> 前貼 <script src="/duo-hinge.js" defer></script>）
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var MIN_PANE = 240;
  var MAX_HINGE = 240;
  var INSET = 16; // 每側留白，避免內容貼到轉軸

  function probe(column, row) {
    var el = document.createElement('div');
    el.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;' +
      'left:env(viewport-segment-left ' + column + ' ' + row + ', 0px);' +
      'top:env(viewport-segment-top ' + column + ' ' + row + ', 0px);' +
      'width:env(viewport-segment-width ' + column + ' ' + row + ', 0px);' +
      'height:env(viewport-segment-height ' + column + ' ' + row + ', 0px)';
    document.body.appendChild(el);
    var r = el.getBoundingClientRect();
    el.remove();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function duoFallback(w, h) {
    // Surface Duo 1 展開橫向的 CSS 尺寸範圍；瀏覽器不吐分段時的備援。
    return w >= 1300 && w <= 1450 && h >= 550 && h <= 950 && w / h >= 1.45;
  }

  function clear() {
    delete root.dataset.duoSpanned;
    root.style.removeProperty('--duo-hinge-start');
    root.style.removeProperty('--duo-hinge-size');
    root.style.removeProperty('--duo-hinge-pane');
  }

  function measure() {
    var a, b;
    try { a = probe(0, 0); b = probe(1, 0); } catch (e) { a = b = null; }
    var w = window.innerWidth, h = window.innerHeight;
    if (a && b) {
      if (a.width >= MIN_PANE && b.width >= MIN_PANE &&
          Math.abs(a.top - b.top) <= 2 && Math.abs(a.height - b.height) <= 2 &&
          b.left > a.left) {
        var gapY = b.left - (a.left + a.width);
        if (gapY >= 0 && gapY <= MAX_HINGE) {
          return apply('y', Math.round(a.left + a.width), Math.round(gapY), Math.round(a.width));
        }
      }
      if (a.width >= MIN_PANE && b.width >= MIN_PANE &&
          Math.abs(a.left - b.left) <= 2 && Math.abs(a.width - b.width) <= 2) {
        var upper = a.top <= b.top ? a : b;
        var lower = a.top <= b.top ? b : a;
        var gapX = Math.round(lower.top - (upper.top + upper.height));
        if (gapX >= 0 && gapX <= MAX_HINGE) {
          return apply('x', Math.round(upper.top + upper.height), gapX, Math.round(upper.width));
        }
      }
    }
    if (duoFallback(w, h)) {
      var hinge = 48;
      var pane = Math.round((w - hinge) / 2);
      return apply('y', pane, hinge, pane);
    }
    clear();
    dispatch(false, null, 0, 0, 0);
  }

  function apply(axis, start, size, pane) {
    root.dataset.duoSpanned = 'true';
    root.dataset.duoHingeAxis = axis;
    root.style.setProperty('--duo-hinge-start', start + 'px');
    root.style.setProperty('--duo-hinge-size', size + 'px');
    root.style.setProperty('--duo-hinge-pane', pane + 'px');
    dispatch(true, axis, start, size, pane);
  }

  function dispatch(spanned, axis, start, size, pane) {
    window.dispatchEvent(new CustomEvent('duohingechange', {
      detail: { spanned: spanned, axis: axis, start: start, size: size, pane: pane }
    }));
  }

  var raf = null;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; measure(); });
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', measure);
  } else {
    measure();
  }
})();
