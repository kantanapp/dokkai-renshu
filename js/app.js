/* ===========================================================
   読解練習 — アプリ本体
   素の JavaScript。フレームワーク・ビルドツールは使わない。
   記録は端末の中(localStorage)だけに持つ。
   =========================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'dokkai-renshu/v1';
  var DATA_URL = 'data/questions.json';

  var data = null;                       // questions.json の中身
  var rec = { v: 1, sets: {} };          // 記録
  var canSave = true;                    // localStorage が使えるか
  var openLevel = null;                  // ホームで開いているレベル
  var nav = { setId: null, index: 0, mode: 'normal' };
  var lastFinish = 'set';                // 'set' | 'retry' — 完了画面の見出し用

  /* ---------- 小さな道具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- ふりがな記法 {漢字|よみ} ----------
     文章を「文字」と「ふりがな付きの語」の並びに分け、
     ふりがなを取りのぞいた文字列(plain)の中での位置も持たせる。
     こうすることで、focus / evidence の位置を plain で探し、
     <ruby> をまたいでも正しい範囲に印を付けられる。            */

  var RUBY_RE = /\{([^{}|]+)\|([^{}|]+)\}/g;

  function parseText(src) {
    var units = [];
    var plain = '';

    function pushPlain(str) {
      var chars = Array.from(str);           // サロゲートペアを壊さない
      for (var i = 0; i < chars.length; i++) {
        var ch = chars[i];
        units.push({
          kind: ch === '\n' ? 'br' : 'char',
          text: ch,
          start: plain.length,
          end: plain.length + ch.length
        });
        plain += ch;
      }
    }

    var last = 0;
    var m;
    RUBY_RE.lastIndex = 0;
    while ((m = RUBY_RE.exec(src)) !== null) {
      pushPlain(src.slice(last, m.index));
      units.push({
        kind: 'ruby',
        text: m[1],
        yomi: m[2],
        start: plain.length,
        end: plain.length + m[1].length
      });
      plain += m[1];
      last = RUBY_RE.lastIndex;
    }
    pushPlain(src.slice(last));

    return { units: units, plain: plain };
  }

  /* needles の各文字列について、plain の中の最初の1つを探し、
     その範囲に少しでもかかる unit を「印あり」にする。
     ふりがな付きの語に一部でもかかれば、その語全体が印になる。 */
  function markRanges(parsed, needles) {
    var marks = [];
    var i;
    for (i = 0; i < parsed.units.length; i++) marks.push(false);
    if (!needles) return marks;

    for (i = 0; i < needles.length; i++) {
      var needle = needles[i];
      if (!needle) continue;
      var at = parsed.plain.indexOf(needle);
      if (at < 0) continue;
      var s = at;
      var e = at + needle.length;
      for (var k = 0; k < parsed.units.length; k++) {
        var u = parsed.units[k];
        if (u.start < e && u.end > s) marks[k] = true;
      }
    }
    return marks;
  }

  /* ふりがなと印を付けた HTML を返す。文字は必ずエスケープする。 */
  function renderText(src, needles) {
    if (src === undefined || src === null) return '';
    var parsed = parseText(String(src));
    var marks = markRanges(parsed, needles);
    var html = '';
    var open = false;

    for (var k = 0; k < parsed.units.length; k++) {
      var u = parsed.units[k];

      if (u.kind === 'br') {
        if (open) { html += '</span>'; open = false; }
        html += '<br>';
        continue;
      }
      if (marks[k] && !open) { html += '<span class="mark">'; open = true; }
      if (!marks[k] && open) { html += '</span>'; open = false; }

      if (u.kind === 'ruby') {
        html += '<ruby>' + esc(u.text) + '<rt>' + esc(u.yomi) + '</rt></ruby>';
      } else {
        html += esc(u.text);
      }
    }
    if (open) html += '</span>';
    return html;
  }

  /* ---------- 記録の読み書き ---------- */

  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.sets) rec = { v: 1, sets: parsed.sets };
      }
    } catch (e) {
      canSave = false;
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(rec));
    } catch (e) {
      canSave = false;
      $('saveWarn').hidden = false;
    }
  }

  function wipe() {
    rec = { v: 1, sets: {} };
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* 消せなくてもアプリは動かす */ }
  }

  function setRec(id) {
    if (!rec.sets[id]) rec.sets[id] = { a: {}, m: {}, r: null };
    var r = rec.sets[id];
    if (!r.a) r.a = {};
    if (!r.m) r.m = {};
    if (r.r === undefined) r.r = null;
    return r;
  }

  /* ---------- データの引き当て ---------- */

  function findSet(id) {
    for (var i = 0; i < data.levels.length; i++) {
      var lv = data.levels[i];
      for (var j = 0; j < lv.sets.length; j++) {
        if (lv.sets[j].id === id) {
          return { level: lv, set: lv.sets[j], no: j + 1, levelIndex: i, setIndex: j };
        }
      }
    }
    return null;
  }

  function markedCount(id, total) {
    var r = rec.sets[id];
    if (!r || !r.m) return 0;
    var n = 0;
    for (var i = 0; i < total; i++) if (r.m[i]) n++;
    return n;
  }

  function isSetDone(s) {
    return markedCount(s.id, s.questions.length) === s.questions.length;
  }

  function levelDone(lv) {
    var n = 0;
    for (var i = 0; i < lv.sets.length; i++) if (isSetDone(lv.sets[i])) n++;
    return n;
  }

  function retryOpen(id) {
    var r = rec.sets[id];
    return !!(r && r.r && r.r.q && r.r.q.length && r.r.i < r.r.q.length);
  }

  /* つづきから：やり直し途中があればそれを、無ければ最初の未完了セット */
  function findResume() {
    var i, j, lv, s;
    for (i = 0; i < data.levels.length; i++) {
      lv = data.levels[i];
      for (j = 0; j < lv.sets.length; j++) {
        if (retryOpen(lv.sets[j].id)) return { id: lv.sets[j].id, mode: 'retry' };
      }
    }
    for (i = 0; i < data.levels.length; i++) {
      lv = data.levels[i];
      for (j = 0; j < lv.sets.length; j++) {
        s = lv.sets[j];
        if (!isSetDone(s)) return { id: s.id, mode: 'normal' };
      }
    }
    return null;
  }

  function firstUnmarked(s) {
    var r = rec.sets[s.id];
    for (var i = 0; i < s.questions.length; i++) {
      if (!r || !r.m || !r.m[i]) return i;
    }
    return 0;
  }

  function nextSetId(id) {
    var f = findSet(id);
    if (!f) return null;
    if (f.setIndex + 1 < f.level.sets.length) return f.level.sets[f.setIndex + 1].id;
    for (var i = f.levelIndex + 1; i < data.levels.length; i++) {
      if (data.levels[i].sets.length) return data.levels[i].sets[0].id;
    }
    return null;
  }

  /* ---------- 画面の出し入れ ---------- */

  var VIEWS = ['viewHome', 'viewQuestion', 'viewCheck', 'viewResult'];

  function show(name) {
    for (var i = 0; i < VIEWS.length; i++) {
      $(VIEWS[i]).hidden = (VIEWS[i] !== name);
    }
    window.scrollTo(0, 0);
  }

  /* ---------- 印の SVG ---------- */

  function markIcon(kind) {
    if (kind === 'o') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B6E63" stroke-width="2.5" role="img" aria-label="できた"><circle cx="12" cy="12" r="8.5"/></svg>';
    }
    if (kind === 't') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7A4F00" stroke-width="2.5" stroke-linejoin="round" role="img" aria-label="おしい"><path d="M12 4.5l8.5 15h-17z"/></svg>';
    }
    if (kind === 'x') {
      return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A6341A" stroke-width="2.5" stroke-linecap="round" role="img" aria-label="もう一度"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    }
    return '<span aria-label="まだ" role="img" style="color:#4A5672;font-weight:700">—</span>';
  }

  var TICK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  /* ===========================================================
     ホーム
     =========================================================== */

  function renderHome() {
    var resume = findResume();

    if (resume) {
      var f = findSet(resume.id);
      var isRetry = resume.mode === 'retry';
      var r = rec.sets[resume.id];
      var touched = r && (Object.keys(r.a).length || Object.keys(r.m).length);

      $('resume').hidden = false;
      $('allDone').hidden = true;
      $('resumeLabel').textContent = isRetry ? 'やり直しのつづき' : 'つづきから';
      $('resumeCount').textContent = levelDone(f.level) + ' / ' + f.level.sets.length + ' セット';
      $('resumeSet').textContent = 'レベル' + f.level.id + ' セット' + f.no;
      $('resumeTheme').textContent = f.level.title;
      $('resumeBar').style.width =
        Math.round((levelDone(f.level) / f.level.sets.length) * 100) + '%';
      $('resumeBtn').textContent =
        isRetry ? 'やり直しをつづける' : (touched ? 'つづきをする' : 'はじめる');
      $('resumeBtn').onclick = function () {
        openSet(resume.id, resume.mode);
      };
    } else {
      $('resume').hidden = true;
      $('allDone').hidden = false;
    }

    renderLevels(resume ? findSet(resume.id).level.id : null);
  }

  function renderLevels(currentLevelId) {
    var box = $('levelList');
    box.textContent = '';

    data.levels.forEach(function (lv) {
      var soon = lv.sets.length === 0;
      var done = levelDone(lv);

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'lvRow' +
        (soon ? ' lvRow--soon' : '') +
        (openLevel === lv.id ? ' lvRow--open' : '') +
        (!soon && currentLevelId === lv.id ? ' lvRow--current' : '');
      row.disabled = soon;
      row.setAttribute('aria-expanded', openLevel === lv.id ? 'true' : 'false');
      row.innerHTML =
        '<span class="lvRow__n">' + esc(lv.id) + '</span>' +
        '<span class="lvRow__t">' + esc(lv.title) + '</span>' +
        '<span class="lvRow__c' + (!soon && done > 0 ? ' lvRow__c--on' : '') + '">' +
        (soon ? '準備中' : esc(done + '/' + lv.sets.length)) + '</span>';

      if (!soon) {
        row.onclick = function () {
          openLevel = (openLevel === lv.id) ? null : lv.id;
          renderHome();
        };
      }
      box.appendChild(row);

      if (!soon && openLevel === lv.id) {
        var list = document.createElement('div');
        list.className = 'setList';
        lv.sets.forEach(function (s, i) {
          var total = s.questions.length;
          var n = markedCount(s.id, total);
          var finished = n === total;
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'setBtn' + (finished ? ' setBtn--done' : '');
          b.innerHTML =
            '<span>セット' + (i + 1) + '</span>' +
            '<span class="setBtn__s">' +
            (finished ? TICK + 'できた' : (n > 0 ? esc(n + '/' + total) : 'まだ')) +
            '</span>';
          b.onclick = function () { openSet(s.id, 'normal'); };
          list.appendChild(b);
        });
        box.appendChild(list);
      }
    });
  }

  /* ===========================================================
     問題
     =========================================================== */

  function current() {
    var f = findSet(nav.setId);
    var q = f.set.questions[nav.index];
    return { f: f, q: q };
  }

  /* 進みバーと「問n / m」 */
  function renderBar(stepsEl, posEl) {
    var f = findSet(nav.setId);
    var total, filled;

    if (nav.mode === 'retry') {
      var r = setRec(nav.setId);
      total = r.r.q.length;
      filled = r.r.i + 1;
      posEl.textContent = filled + ' / ' + total;
    } else {
      total = f.set.questions.length;
      filled = nav.index + 1;
      posEl.textContent = '問' + filled + ' / ' + total;
    }

    stepsEl.style.setProperty('--n', total);
    var html = '';
    for (var i = 0; i < total; i++) {
      html += '<div class="steps__i' + (i < filled ? ' steps__i--on' : '') + '"></div>';
    }
    stepsEl.innerHTML = html;
  }

  function openSet(id, mode) {
    nav.setId = id;
    nav.mode = mode;
    var r = setRec(id);

    if (mode === 'retry' && retryOpen(id)) {
      nav.index = r.r.q[r.r.i];
    } else {
      nav.mode = 'normal';
      nav.index = firstUnmarked(findSet(id).set);
    }
    renderQuestion();
  }

  function renderQuestion() {
    var c = current();
    var q = c.q;
    var focus = q.focus ? [q.focus] : null;

    $('qSetName').textContent = 'レベル' + c.f.level.id + '・セット' + c.f.no;
    $('qRetryNote').hidden = nav.mode !== 'retry';
    renderBar($('qSteps'), $('qPos'));

    $('qPassage').innerHTML = renderText(c.f.set.passage, focus);
    $('qNo').textContent = '問' + (nav.index + 1);
    $('qKind').textContent = q.kind;
    $('qText').innerHTML = renderText(q.q, focus);

    var box = $('answerBox');
    var r = setRec(nav.setId);
    box.value = r.a[nav.index] || '';
    $('qHint').hidden = true;

    show('viewQuestion');
  }

  function onAnswerInput() {
    if (nav.setId === null) return;
    var r = setRec(nav.setId);
    r.a[nav.index] = $('answerBox').value;
    save();
    if ($('answerBox').value.trim()) $('qHint').hidden = true;
  }

  /* ===========================================================
     解説
     =========================================================== */

  function renderCheck() {
    var c = current();
    var q = c.q;
    var r = setRec(nav.setId);

    renderBar($('cSteps'), $('cPos'));
    $('cQuestion').innerHTML = renderText(q.q, null);

    var mine = (r.a[nav.index] || '').trim();
    $('cMine').textContent = mine || '(書いていません)';
    $('cMine').className = 'mine__text' + (mine ? '' : ' mine__text--empty');

    $('cPassage').innerHTML = renderText(c.f.set.passage, q.evidence || []);
    $('cOpenNote').hidden = !q.open;

    var ol = $('cSteps2');
    ol.textContent = '';
    (q.steps || []).forEach(function (st, i) {
      var li = document.createElement('li');
      li.innerHTML =
        '<span class="stepsList__n">' + (i + 1) + '</span>' +
        '<span class="stepsList__t">' + renderText(st, null) + '</span>';
      ol.appendChild(li);
    });

    $('cSample').innerHTML = renderText(q.answer, null);

    var picked = r.m[nav.index] || '';
    var btns = document.querySelectorAll('#viewCheck .mk');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-checked', btns[i].dataset.mark === picked ? 'true' : 'false');
    }

    $('cNext').textContent = isLastInRun() ? '結果を見る' : '次の問題へ';
    $('cHint').hidden = true;

    show('viewCheck');
  }

  function isLastInRun() {
    if (nav.mode === 'retry') {
      var r = setRec(nav.setId);
      return r.r.i >= r.r.q.length - 1;
    }
    return nav.index >= findSet(nav.setId).set.questions.length - 1;
  }

  function pickMark(kind) {
    var r = setRec(nav.setId);
    r.m[nav.index] = kind;
    save();
    var btns = document.querySelectorAll('#viewCheck .mk');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-checked', btns[i].dataset.mark === kind ? 'true' : 'false');
    }
    $('cHint').hidden = true;
  }

  function goNext() {
    var r = setRec(nav.setId);
    if (!r.m[nav.index]) {
      $('cHint').hidden = false;
      return;
    }

    if (nav.mode === 'retry') {
      r.r.i += 1;
      save();
      if (r.r.i >= r.r.q.length) {
        r.r = null;
        save();
        lastFinish = 'retry';
        renderResult();
      } else {
        nav.index = r.r.q[r.r.i];
        renderQuestion();
      }
      return;
    }

    if (nav.index >= findSet(nav.setId).set.questions.length - 1) {
      lastFinish = 'set';
      renderResult();
    } else {
      nav.index += 1;
      renderQuestion();
    }
  }

  /* ===========================================================
     セット完了
     =========================================================== */

  function renderResult() {
    var f = findSet(nav.setId);
    var qs = f.set.questions;
    var r = setRec(nav.setId);

    $('rSetName').textContent = 'レベル' + f.level.id + '・セット' + f.no;
    $('rTitle').textContent =
      lastFinish === 'retry' ? 'やり直し、おわり。' : qs.length + '問、おわり。';

    var n = { o: 0, t: 0, x: 0 };
    qs.forEach(function (q, i) {
      var m = r.m[i];
      if (m && n[m] !== undefined) n[m] += 1;
    });
    $('rO').textContent = n.o;
    $('rT').textContent = n.t;
    $('rX').textContent = n.x;

    var list = $('rList');
    list.textContent = '';
    qs.forEach(function (q, i) {
      var row = document.createElement('div');
      row.className = 'list__row';
      row.innerHTML =
        '<span class="list__n">問' + (i + 1) + '</span>' +
        '<span class="list__k">' + esc(q.kind) + '</span>' +
        '<span class="list__m">' + markIcon(r.m[i]) + '</span>';
      list.appendChild(row);
    });

    $('rWord').textContent = wordFor(qs, r);

    /* 次のセットへ */
    var nid = nextSetId(nav.setId);
    var nextBtn = $('rNextSet');
    if (nid) {
      nextBtn.hidden = false;
      nextBtn.onclick = function () { openSet(nid, 'normal'); };
    } else {
      nextBtn.hidden = true;
    }

    /* △と×のやり直し */
    var bad = [];
    qs.forEach(function (q, i) {
      if (r.m[i] === 't' || r.m[i] === 'x') bad.push(i);
    });
    var retryBtn = $('rRetry');
    if (bad.length) {
      var names = bad.map(function (i) { return '問' + (i + 1); });
      retryBtn.hidden = false;
      retryBtn.textContent = names.join(bad.length === 2 ? 'と' : '・') + 'をやり直す';
      retryBtn.onclick = function () {
        var rr = setRec(nav.setId);
        rr.r = { q: bad, i: 0 };
        save();
        openSet(nav.setId, 'retry');
      };
    } else {
      retryBtn.hidden = true;
    }

    show('viewResult');
  }

  /* ひとこと：○でなかった問いの種類から文を組む */
  function wordFor(qs, r) {
    var openKinds = [];
    var closedKinds = [];
    qs.forEach(function (q, i) {
      if (r.m[i] === 'o') return;
      var list = q.open ? openKinds : closedKinds;
      if (list.indexOf(q.kind) < 0) list.push(q.kind);
    });

    function join(arr) {
      return arr.map(function (k) { return '「' + k + '」'; })
        .join(arr.length === 2 ? 'と' : '・');
    }

    if (!openKinds.length && !closedKinds.length) {
      return '全部できた。次のセットへ進もう。';
    }
    if (openKinds.length && !closedKinds.length) {
      return join(openKinds) + 'は、文章に答えが書かれていない問題。行動や出来事から考えてみよう。';
    }
    if (!openKinds.length && closedKinds.length) {
      return join(closedKinds) + 'は、答えが文章の中にある問題。解説の黄色い部分をもう一度見てみよう。';
    }
    return join(closedKinds) + 'は文章の中に答えがある問題。' +
      join(openKinds) + 'は書かれていない問題。解説をもう一度読んでみよう。';
  }

  /* ===========================================================
     結びつけ
     =========================================================== */

  function bind() {
    $('answerBox').addEventListener('input', onAnswerInput);

    $('qBack').onclick = function () { renderHome(); show('viewHome'); };
    $('qDone').onclick = function () {
      if (!$('answerBox').value.trim()) {
        $('qHint').hidden = false;
        return;
      }
      $('qHint').hidden = true;
      renderCheck();
    };
    $('qSkip').onclick = function () { renderCheck(); };

    $('cBack').onclick = function () { renderQuestion(); };
    $('cNext').onclick = goNext;

    var mks = document.querySelectorAll('#viewCheck .mk');
    for (var i = 0; i < mks.length; i++) {
      (function (btn) {
        btn.onclick = function () { pickMark(btn.dataset.mark); };
      })(mks[i]);
    }

    $('rHome').onclick = function () { renderHome(); show('viewHome'); };

    /* 記録を消す（ブラウザの confirm は使わず画面内で確認する） */
    $('resetOpen').onclick = function () {
      $('resetPanel').hidden = false;
      $('resetDone').hidden = true;
      $('resetOpen').hidden = true;
    };
    $('resetNo').onclick = function () {
      $('resetPanel').hidden = true;
      $('resetOpen').hidden = false;
    };
    $('resetYes').onclick = function () {
      wipe();
      openLevel = null;
      $('resetPanel').hidden = true;
      $('resetOpen').hidden = false;
      $('resetDone').hidden = false;
      renderHome();
    };
  }

  /* ===========================================================
     立ち上げ
     =========================================================== */

  function start() {
    load();
    if (!canSave) $('saveWarn').hidden = false;
    bind();
    $('boot').hidden = true;
    renderHome();
    show('viewHome');
  }

  function fail(msg) {
    $('bootMsg').textContent = msg;
    $('bootRetry').hidden = false;
  }

  function fetchData() {
    $('bootMsg').textContent = '問題を読み込んでいます…';
    $('bootRetry').hidden = true;

    fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json || !json.levels || !json.levels.length) throw new Error('形が違う');
        data = json;
        start();
      })
      .catch(function () {
        fail('問題を読み込めませんでした。電波のある場所で、もう一度ためしてください。');
      });
  }

  $('bootRetry').onclick = fetchData;
  fetchData();
})();
