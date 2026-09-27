/* QuizDesk 网页版 —— 纯静态刷题应用，无需后端 */
(function () {
  'use strict';

  var bank = window.QUESTION_BANK || {};
  var questions = bank.questions || [];
  var WRONG_KEY = 'quizdesk_wrong_ids';

  /* ---------- 状态 ---------- */
  var state = {
    sources: new Set(),      // 勾选的来源，空 = 全部
    types: new Set(),        // 勾选的题型，空 = 全部
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
  questions.forEach(function (q) {
    if (allSources.indexOf(q.source) === -1) allSources.push(q.source);
    if (allTypes.indexOf(q.type) === -1) allTypes.push(q.type);
  });

  function filtered() {
    var list = questions.filter(function (q) {
      if (state.sources.size && !state.sources.has(q.source)) return false;
      if (state.types.size && !state.types.has(q.type)) return false;
      if ($('only-wrong').checked && !wrongSet.has(q.id)) return false;
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
    $('q-stem').textContent = q.stem || '(缺少题干)';

    var isChoice = q.options && q.options.length > 0;
    $('q-options').classList.toggle('hidden', !isChoice);
    $('q-fill').classList.toggle('hidden', isChoice);

    if (isChoice) {
      var box = $('q-options');
      box.innerHTML = '';
      q.options.forEach(function (opt) {
        var o = splitOption(opt);
        var div = document.createElement('div');
        div.className = 'option';
        div.innerHTML = '<span class="opt-key">' + esc(o.key || '·') + '</span><span>' + esc(o.text) + '</span>';
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
  }

  function updateStats() {
    $('stat-done').textContent = state.session.done;
    $('stat-total').textContent = state.order.length;
    $('stat-right').textContent = state.session.right;
    $('stat-wrong').textContent = state.session.wrong;
    $('stat-rate').textContent = state.session.done
      ? Math.round(state.session.right / state.session.done * 100) + '%'
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
  $('restart').addEventListener('click', function () {
    state.answers = {};
    state.session = { done: 0, right: 0, wrong: 0 };
    rebuildOrder(false);
  });

  /* ---------- 启动 ---------- */
  $('bank-name').textContent = (bank.bank && bank.bank.name || '') +
    ' · 共 ' + questions.length + ' 题';
  buildFilters();
  rebuildOrder(false);
})();
