/* QuizDesk 网页版 —— 纯静态可用，检测到后端 API 时自动进入服务器模式 */
(function () {
  'use strict';

  var bank = window.QUESTION_BANK || {};
  var questions = bank.questions || [];
  var WRONG_KEY = 'quizdesk_wrong_ids';
  var DEVICE_KEY = 'quizdesk_device_id';
  var BANK_KEY = 'quizdesk_bank_id';
  var SERVER_MODE = false;

  /* 动效：Anime.js 驱动；用户系统开启"减弱动态效果"时自动禁用 */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ANIME = (typeof window.anime === 'function' && !REDUCED) ? window.anime : null;
  var lastQid = null;
  var prevStats = { done: 0, right: 0, wrong: 0 };

  /* ---------- 状态 ---------- */
  var state = {
    sources: new Set(),      // 勾选的来源，空 = 全部
    types: new Set(),        // 勾选的题型，空 = 全部
    cats: new Set(),         // 勾选的自定义类别（任一命中即显示）
    order: [],               // 当前题目 id 顺序
    idx: 0,
    answers: {},             // id -> {selected, input, checked, correct}
    session: { done: 0, right: 0, wrong: 0 }
  };

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function loadWrong() {
    try { return new Set(JSON.parse(localStorage.getItem(WRONG_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveWrong(set) {
    localStorage.setItem(WRONG_KEY, JSON.stringify(Array.from(set)));
  }
  var wrongSet = loadWrong();

  /* ---------- 标记存储：重点 + 自定义类别（按题库隔离，存本机浏览器） ---------- */
  var MARKS_KEY = 'quizdesk_marks';
  var FOLD_KEY = 'quizdesk_fold';
  var bankId = (bank.bank && bank.bank.id) || 'default';
  var marks = (function () {
    try { return JSON.parse(localStorage.getItem(MARKS_KEY) || '{}'); }
    catch (e) { return {}; }
  })();
  function m() {
    if (!marks[bankId]) marks[bankId] = { star: [], cats: {} };
    if (!Array.isArray(marks[bankId].star)) marks[bankId].star = [];
    if (!marks[bankId].cats || typeof marks[bankId].cats !== 'object') marks[bankId].cats = {};
    return marks[bankId];
  }
  function saveMarks() { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); }
  function isStarred(id) { return m().star.indexOf(id) !== -1; }
  function toggleStar(id) {
    var a = m().star, i = a.indexOf(id);
    if (i === -1) a.push(id); else a.splice(i, 1);
    saveMarks();
  }
  function catNames() { return Object.keys(m().cats); }
  function setCatsFor(id, name, on) {
    var arr = m().cats[name] || (m().cats[name] = []);
    var i = arr.indexOf(id);
    if (on && i === -1) arr.push(id);
    if (!on && i !== -1) arr.splice(i, 1);
    saveMarks();
  }
  function addCat(name) {
    name = String(name || '').trim();
    if (!name || m().cats[name]) return false;
    m().cats[name] = [];
    saveMarks();
    return true;
  }
  function delCat(name) {
    delete m().cats[name];
    state.cats.delete(name);
    saveMarks();
  }

  function deviceId() {
    var id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  function syncMsg(text) { $('sync-msg').textContent = text; }

  function uploadWrong() {
    fetch('/api/wrong/' + encodeURIComponent(deviceId()), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(wrongSet) })
    }).then(function (r) { return r.json(); }).then(function (d) {
      syncMsg('已上传 ' + (d.ids ? d.ids.length : wrongSet.size) + ' 道错题');
    }).catch(function () { syncMsg('上传失败，检查网络'); });
  }
  function pullWrong() {
    fetch('/api/wrong/' + encodeURIComponent(deviceId()))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        (d.ids || []).forEach(function (i) { wrongSet.add(i); });
        saveWrong(wrongSet);
        syncMsg('已拉取，错题本共 ' + wrongSet.size + ' 题');
        rebuildOrder(false);
      })
      .catch(function () { syncMsg('拉取失败，检查网络'); });
  }

  /* 填空题归一化：去空白/引号、全角转半角、去掉 (1) 类题号前缀、忽略大小写与末尾标点 */
  function normFill(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[\s'"`]/g, '')
      .replace(/\(\d+\)/g, '')
      .replace(/[。．.，,;；!！?？]+$/g, '');
  }
  /* "A. xxx" -> {key:"A", text:"xxx"} */
  function splitOption(opt) {
    var m = String(opt).match(/^\s*([A-Za-z])[\.、．:：]\s*([\s\S]*)$/);
    return m ? { key: m[1].toUpperCase(), text: m[2] } : { key: '', text: String(opt) };
  }
  /* 选择题的正确选项字母：answer 可能是字母，也可能是选项文本（判断题的"对/错"） */
  function correctKey(q) {
    var ans = String(q.answer == null ? '' : q.answer).trim();
    if (q.options && q.options.length) {
      var direct = q.options.find(function (o) { return splitOption(o).key.toUpperCase() === ans.toUpperCase(); });
      if (direct) return splitOption(direct).key;
      var byText = q.options.find(function (o) {
        return splitOption(o).text.replace(/\s/g, '') === ans.replace(/\s/g, '');
      });
      if (byText) return splitOption(byText).key;
    }
    return ans.toUpperCase();
  }
  /* 填空题判分：答案中 ；/; 分隔的每个变体都算对 */
  function fillCorrect(q, input) {
    var variants = String(q.answer || '').split(/[；;]/).map(normFill).filter(Boolean);
    var v = normFill(input);
    return v !== '' && variants.indexOf(v) !== -1;
  }

  /* ---------- 列表构建 ---------- */
  var allSources = [], allTypes = [];
  function collectFacets() {
    allSources = []; allTypes = [];
    questions.forEach(function (q) {
      if (allSources.indexOf(q.source) === -1) allSources.push(q.source);
      if (allTypes.indexOf(q.type) === -1) allTypes.push(q.type);
    });
  }
  collectFacets();

  function filtered() {
    var list = questions.filter(function (q) {
      if (state.sources.size && !state.sources.has(q.source)) return false;
      if (state.types.size && !state.types.has(q.type)) return false;
      if ($('only-wrong').checked && !wrongSet.has(q.id)) return false;
      if ($('only-star').checked && !isStarred(q.id)) return false;
      if (state.cats.size) {
        var inAny = catNames().some(function (n) {
          return state.cats.has(n) && (m().cats[n] || []).indexOf(q.id) !== -1;
        });
        if (!inAny) return false;
      }
      return true;
    });
    if ($('shuffle').checked) {
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
    }
    return list;
  }
  function byId(id) {
    return questions.find(function (q) { return q.id === id; });
  }

  function rebuildOrder(keepPosition) {
    state.order = filtered().map(function (q) { return q.id; });
    if (!keepPosition) state.idx = 0;
    if (state.idx >= state.order.length) state.idx = Math.max(0, state.order.length - 1);
    updateStats();
    render();
  }

  /* ---------- 筛选面板 ---------- */
  function buildFilters() {
    var sf = $('source-filters');
    sf.innerHTML = '';
    allSources.forEach(function (s) {
      var n = questions.filter(function (q) { return q.source === s; }).length;
      var label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" value="' + esc(s) + '"> <span>' + esc(s) +
        '</span><span class="count">' + n + '</span>';
      label.querySelector('input').addEventListener('change', function () {
        if (this.checked) state.sources.add(this.value); else state.sources.delete(this.value);
        rebuildOrder(false);
      });
      sf.appendChild(label);
    });
    var tf = $('type-filters');
    tf.innerHTML = '';
    allTypes.forEach(function (t) {
      var n = questions.filter(function (q) { return q.type === t; }).length;
      var label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" value="' + esc(t) + '"> <span>' + esc(t) +
        '</span><span class="count">' + n + '</span>';
      label.querySelector('input').addEventListener('change', function () {
        if (this.checked) state.types.add(this.value); else state.types.delete(this.value);
        rebuildOrder(false);
      });
      tf.appendChild(label);
    });
    buildCats();
  }

  function buildCats() {
    var box = $('cat-filters');
    box.innerHTML = '';
    var names = catNames();
    if (!names.length) {
      box.innerHTML = '<div class="empty-tip2">还没有类别：在下方添加（如"第一章""易错"），然后在题目上点 🏷 归类。</div>';
      return;
    }
    names.forEach(function (n) {
      var cnt = (m().cats[n] || []).length;
      var label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" value="' + esc(n) + '"' +
        (state.cats.has(n) ? ' checked' : '') + '> <span>🏷 ' + esc(n) + '</span><span class="count">' + cnt +
        '</span><button class="del-cat" title="删除该类别">✕</button>';
      label.querySelector('input').addEventListener('change', function () {
        if (this.checked) state.cats.add(n); else state.cats.delete(n);
        rebuildOrder(false);
      });
      label.querySelector('.del-cat').addEventListener('click', function (e) {
        e.preventDefault();
        delCat(n);
        buildCats();
        rebuildOrder(false);
      });
      box.appendChild(label);
    });
  }

  /* ---------- 动效（Anime.js） ---------- */
  function animateQuestionIn() {
    if (!ANIME) return;
    ANIME({
      targets: '#question-card',
      opacity: [0, 1], translateY: [18, 0],
      duration: 380, easing: 'easeOutCubic'
    });
    ANIME({
      targets: '#q-options .option',
      opacity: [0, 1], translateX: [-14, 0],
      delay: ANIME.stagger(55),
      duration: 320, easing: 'easeOutQuad'
    });
  }
  function animateFeedback(ok) {
    if (!ANIME) return;
    if (ok === true) {
      ANIME({ targets: '#feedback', scale: [0.92, 1], opacity: [0, 1], duration: 340, easing: 'easeOutBack' });
    } else if (ok === false) {
      ANIME({
        targets: '#question-card',
        translateX: [0, -10, 10, -6, 6, 0],
        duration: 380, easing: 'easeInOutQuad'
      });
      ANIME({ targets: '#feedback', opacity: [0, 1], duration: 260, easing: 'easeOutQuad' });
    }
  }
  function animateStats(done, right, wrong) {
    var d = $('stat-done'), r = $('stat-right'), w = $('stat-wrong');
    if (!ANIME) { d.textContent = done; r.textContent = right; w.textContent = wrong; return; }
    var o = { d: prevStats.done, r: prevStats.right, w: prevStats.wrong };
    ANIME({
      targets: o,
      d: done, r: right, w: wrong,
      round: 1, duration: 480, easing: 'easeOutQuad',
      update: function () { d.textContent = o.d; r.textContent = o.r; w.textContent = o.w; },
      complete: function () { d.textContent = done; r.textContent = right; w.textContent = wrong; }
    });
  }

  /* ---------- 渲染 ---------- */
  var current = null;

  function render() {
    var card = $('question-card'), empty = $('empty-tip');
    if (!state.order.length) {
      card.classList.add('hidden');
      empty.classList.remove('hidden');
      $('progress-bar').style.width = '0';
      return;
    }
    card.classList.remove('hidden');
    empty.classList.add('hidden');

    var q = byId(state.order[state.idx]);
    current = q;
    var rec = state.answers[q.id] || (state.answers[q.id] = {});

    $('q-source').textContent = q.source;
    $('q-type').textContent = q.type + ' · ' + (q.score || 0) + ' 分';
    $('q-no').textContent = (state.idx + 1) + ' / ' + state.order.length;
    $('q-verify').classList.toggle('hidden', q.answerStatus !== 'student_marked_unverified');
    var starBtn = $('q-star');
    starBtn.classList.toggle('on', isStarred(q.id));
    starBtn.textContent = isStarred(q.id) ? '★ 重点' : '☆ 重点';
    $('q-stem').textContent = q.stem || '(缺少题干)';

    var isChoice = q.options && q.options.length > 0;
    $('q-options').classList.toggle('hidden', !isChoice);
    $('q-fill').classList.toggle('hidden', isChoice);

    if (isChoice) {
      var box = $('q-options');
      box.innerHTML = '';
      q.options.forEach(function (opt, i) {
        var o = splitOption(opt);
        var div = document.createElement('div');
        div.className = 'option';
        div.innerHTML = '<span class="opt-key">' + esc(o.key || '·') + '</span><span>' + esc(o.text) + '</span>' +
          '<span class="opt-num" title="键盘快捷键">' + (i + 1) + '</span>';
        if (rec.checked) {
          if (o.key === correctKey(q)) div.classList.add('correct');
          else if (o.key === rec.selected) div.classList.add('incorrect');
        } else if (o.key === rec.selected) {
          div.classList.add('selected');
        }
        div.addEventListener('click', function () {
          if (state.answers[q.id].checked) return;
          rec.selected = o.key;
          Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('selected'); });
          div.classList.add('selected');
        });
        box.appendChild(div);
      });
    } else {
      var input = $('fill-input');
      input.value = rec.input || '';
      input.disabled = !!rec.checked;
      input.onkeydown = function (e) { if (e.key === 'Enter') checkAnswer(); };
    }

    $('btn-check').disabled = !!rec.checked;
    $('btn-check').textContent = rec.checked ? '已提交' : '提交答案';
    renderFeedback(q, rec);

    var pct = state.order.length ? Math.round(((state.idx + 1) / state.order.length) * 100) : 0;
    $('progress-bar').style.width = pct + '%';

    if (q.id !== lastQid) {
      lastQid = q.id;
      $('cat-pop').classList.add('hidden');
      animateQuestionIn();
    }
  }

  function renderFeedback(q, rec) {
    var fb = $('feedback');
    if (!rec.checked) { fb.classList.add('hidden'); return; }
    fb.classList.remove('hidden');
    if (rec.correct === 'missing') {
      fb.className = 'feedback';
      fb.innerHTML = '<span class="ans">该题缺少答案，未计入判分。</span>' +
        (q.analysis ? '<div class="analysis">解析：' + esc(q.analysis) + '</div>' : '');
      return;
    }
    var ok = rec.correct === true;
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    var ansText = (q.options && q.options.length)
      ? correctKey(q)
      : String(q.answer || '');
    fb.innerHTML = (ok ? '✅ 回答正确' : '❌ 回答错误') +
      '<div class="ans">正确答案：' + esc(ansText) + '</div>' +
      (q.analysis ? '<div class="analysis">解析：' + esc(q.analysis) + '</div>' : '');
  }

  /* ---------- 交互 ---------- */
  function checkAnswer() {
    if (!current) return;
    var rec = state.answers[current.id];
    if (rec.checked) return;
    var isChoice = current.options && current.options.length > 0;

    if (isChoice && !rec.selected) return;
    if (!isChoice && normFill(rec.input) === '') return;

    if (current.answerStatus === 'missing') {
      rec.checked = true; rec.correct = 'missing';
    } else {
      var ok = isChoice
        ? rec.selected === correctKey(current)
        : fillCorrect(current, rec.input);
      rec.checked = true; rec.correct = ok;
      state.session.done++;
      if (ok) {
        state.session.right++;
        wrongSet.delete(current.id);
      } else {
        state.session.wrong++;
        wrongSet.add(current.id);
      }
      saveWrong(wrongSet);
      updateStats();
    }
    render();
    animateFeedback(rec.correct);
  }

  function updateStats() {
    var s2 = state.session;
    $('stat-total').textContent = state.order.length;
    animateStats(s2.done, s2.right, s2.wrong);
    prevStats = { done: s2.done, right: s2.right, wrong: s2.wrong };
    $('stat-rate').textContent = s2.done
      ? Math.round(s2.right / s2.done * 100) + '%'
      : '—';
  }

  $('btn-check').addEventListener('click', checkAnswer);
  $('btn-prev').addEventListener('click', function () {
    if (state.idx > 0) { state.idx--; render(); }
  });
  $('btn-next').addEventListener('click', function () {
    if (state.idx < state.order.length - 1) { state.idx++; render(); }
  });
  $('fill-input').addEventListener('input', function () {
    if (current) state.answers[current.id].input = this.value;
  });
  $('shuffle').addEventListener('change', function () { rebuildOrder(false); });
  $('only-wrong').addEventListener('change', function () { rebuildOrder(false); });
  $('only-star').addEventListener('change', function () { rebuildOrder(false); });

  $('q-star').addEventListener('click', function () {
    if (!current) return;
    toggleStar(current.id);
    render();
  });

  function renderCatPop() {
    var pop = $('cat-pop');
    if (pop.classList.contains('hidden') || !current) return;
    var names = catNames();
    pop.innerHTML = names.length ? '' :
      '<div class="empty-tip2">还没有类别，先去左侧"自定义类别"添加一个。</div>';
    names.forEach(function (n) {
      var on = (m().cats[n] || []).indexOf(current.id) !== -1;
      var row = document.createElement('label');
      row.className = 'cat-row';
      row.innerHTML = '<input type="checkbox"' + (on ? ' checked' : '') + '> <span>' + esc(n) + '</span>';
      row.querySelector('input').addEventListener('change', function () {
        setCatsFor(current.id, n, this.checked);
        buildCats();
      });
      pop.appendChild(row);
    });
  }
  $('q-cats').addEventListener('click', function (e) {
    e.stopPropagation();
    var pop = $('cat-pop');
    pop.classList.toggle('hidden');
    renderCatPop();
  });
  document.addEventListener('click', function (e) {
    var pop = $('cat-pop');
    if (!pop.classList.contains('hidden') && !pop.contains(e.target) &&
        e.target !== $('q-cats') && !$('q-cats').contains(e.target)) {
      pop.classList.add('hidden');
    }
  });

  $('cat-add').addEventListener('click', function () {
    var inp = $('cat-name');
    if (addCat(inp.value)) { inp.value = ''; buildCats(); }
    else inp.focus();
  });
  $('cat-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('cat-add').click();
  });

  /* 折叠面板：状态持久化 */
  (function initFolds() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('.foldable'), function (h) {
      var key = h.getAttribute('data-fold');
      if (saved[key]) h.classList.add('folded');
      h.addEventListener('click', function () {
        h.classList.toggle('folded');
        saved[key] = h.classList.contains('folded');
        localStorage.setItem(FOLD_KEY, JSON.stringify(saved));
      });
    });
  })();
  $('restart').addEventListener('click', function () {
    state.answers = {};
    state.session = { done: 0, right: 0, wrong: 0 };
    rebuildOrder(false);
  });

  /* ---------- 键盘快捷键：1~9/字母选选项，Enter 提交/下一题，←→ 翻题 ---------- */
  function selectByIndex(i) {
    if (!current) return;
    var rec = state.answers[current.id];
    if (!current.options || rec.checked) return;
    if (i < 0 || i >= current.options.length) return;
    rec.selected = splitOption(current.options[i]).key;
    render();
  }
  document.addEventListener('keydown', function (e) {
    if (e.target === $('fill-input') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { selectByIndex(Number(e.key) - 1); return; }
    if (/^[fF]$/.test(e.key) && current) { toggleStar(current.id); render(); return; }
    if (/^[a-dA-D]$/.test(e.key)) {
      var i = 'abcd'.indexOf(e.key.toLowerCase());
      if (current && i < current.options.length) selectByIndex(i);
      return;
    }
    if (e.key === 'Enter') {
      var rec = current && state.answers[current.id];
      if (rec && rec.checked) {
        if (state.idx < state.order.length - 1) { state.idx++; render(); }
      } else checkAnswer();
      return;
    }
    if (e.key === 'ArrowLeft' && state.idx > 0) { state.idx--; render(); }
    if (e.key === 'ArrowRight' && state.idx < state.order.length - 1) { state.idx++; render(); }
  });

  /* ---------- 题库切换与启动 ---------- */
  function setBank(doc) {
    bank = doc || { questions: [] };
    questions = bank.questions || [];
    bankId = (doc.bank && doc.bank.id) || bankId;
    collectFacets();
    state.sources.clear(); state.types.clear(); state.cats.clear();
    state.answers = {};
    state.session = { done: 0, right: 0, wrong: 0 };
    $('bank-name').textContent = ((bank.bank && bank.bank.name) || '题库') +
      ' · 共 ' + questions.length + ' 题';
    buildFilters();
    rebuildOrder(false);
  }

  var booted = false;
  function initEmbedded() {
    if (booted) return;
    booted = true;
    setBank(window.QUESTION_BANK);
  }
  function initServer(banks) {
    if (booted) return;
    booted = true;
    SERVER_MODE = true;
    var sel = $('bank-select');
    sel.innerHTML = '';
    banks.forEach(function (b) {
      var opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = (b.name || b.id) + '（' + (b.count != null ? b.count : '?') + ' 题）';
      sel.appendChild(opt);
    });
    var last = localStorage.getItem(BANK_KEY);
    if (last && banks.some(function (b) { return b.id === last; })) sel.value = last;
    $('bank-block').style.display = '';
    $('sync-block').style.display = '';
    sel.addEventListener('change', function () {
      localStorage.setItem(BANK_KEY, sel.value);
      loadServerBank(sel.value);
    });
    $('sync-push').addEventListener('click', uploadWrong);
    $('sync-pull').addEventListener('click', pullWrong);
    loadServerBank(sel.value);
  }
  function loadServerBank(id) {
    $('bank-name').textContent = '题库加载中…';
    fetch('/api/bank/' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (doc) { setBank(doc); })
      .catch(function () { $('bank-name').textContent = '题库加载失败，请刷新重试'; });
  }

  (function boot() {
    var timer = setTimeout(initEmbedded, 2000);   // 无后端（file:// 或纯静态托管）时兜底
    fetch('/api/banks').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) {
      clearTimeout(timer);
      if (d && d.banks && d.banks.length) initServer(d.banks);
      else initEmbedded();
    }).catch(function () {
      clearTimeout(timer);
      initEmbedded();
    });
  })();
})();
