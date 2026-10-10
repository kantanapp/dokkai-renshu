/* ===========================================================
   読解練習 — GA4（Google アナリティクス）

   ★ 使い方
     下の GA_ID に、GA4 管理画面で発行した測定ID（G-から始まる）を入れる。
     空のままなら GA4 は読み込まれず、何も送らない（アプリは普通に動く）。

   ★ 送らないもの
     書いた答えの中身は絶対に送らない。送るのは「どの画面を見たか」
     「どのセットの何問目か」「○△×のどれを選んだか」だけ。
   =========================================================== */
(function () {
  'use strict';

  var GA_ID = 'G-66R7MWB5JF';   /* GA4「gen LP群」の kantanapp ウェブストリーム */

  /* 既定は「何もしない」。測定IDが入っていないときはこのまま */
  window.track = function () {};

  if (!GA_ID || GA_ID.slice(0, 2) !== 'G-') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag('js', new Date());
  gtag('config', GA_ID, {
    /* 子どもが使うアプリなので、広告まわりの機能は切っておく */
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);

  window.track = function (name, params) {
    try { gtag('event', name, params || {}); } catch (e) { /* 送れなくてもアプリは動く */ }
  };
})();
