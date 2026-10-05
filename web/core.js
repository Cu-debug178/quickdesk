/* QuizDesk 核心纯逻辑（Node 与浏览器共用：无 DOM、无 localStorage）
 * 浏览器暴露 window.QuizCore；Node 通过 module.exports 引用（tests/core.test.js）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuizCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_LEN = 20;

  /* 归一化标签名：去首尾空白、连续空白折叠为单个空格（含全角）、限 20 字；无效返回 null */
  function normalizeTagName(s) {
    if (typeof s !== 'string') return null;
    var v = s.replace(/[\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!v) return null;
    if (v.length > MAX_LEN) v = v.slice(0, MAX_LEN);
    return v;
  }

  /* 标签数据结构：{ tags: {名字: [题目id]}, tagOrder: [名字，最近使用在前] } */

  function addTagToQuestion(marks, qid, rawName) {
    var name = normalizeTagName(rawName);
    if (!name || !qid) return marks;
    var tags = marks.tags || {}, order = marks.tagOrder || [];
    var arr = tags[name] || [];
    if (arr.indexOf(qid) === -1) arr = arr.concat([qid]);
    tags[name] = arr;
    order = order.filter(function (n) { return n !== name; });
    order.unshift(name);
    return { tags: tags, tagOrder: order };
  }

  function removeTagFromQuestion(marks, qid, name) {
    var tags = marks.tags || {}, order = marks.tagOrder || [];
    if (!tags[name]) return marks;
    var arr = tags[name].filter(function (id) { return id !== qid; });
    if (arr.length) {
      tags[name] = arr;
      return { tags: tags, tagOrder: order };
    }
    return deleteTag({ tags: tags, tagOrder: order }, name);
  }

  function deleteTag(marks, name) {
    var tags = marks.tags || {}, order = marks.tagOrder || [];
    if (!tags[name]) return marks;
    var next = {};
    Object.keys(tags).forEach(function (k) { if (k !== name) next[k] = tags[k]; });
    return { tags: next, tagOrder: order.filter(function (n) { return n !== name; }) };
  }

  /* 多个选中标签的题目 id 并集 */
  function questionsForTags(marks, selected) {
    var tags = marks.tags || {};
    var out = [];
    (selected || []).forEach(function (n) {
      (tags[n] || []).forEach(function (id) {
        if (out.indexOf(id) === -1) out.push(id);
      });
    });
    return out;
  }

  /* 输入建议：大小写不敏感的前缀命中在前、子串命中在后 */
  function findSimilarTags(input, existing) {
    var q = normalizeTagName(input);
    if (!q) return [];
    var low = q.toLowerCase();
    var starts = [], includes = [];
    (existing || []).forEach(function (n) {
      var nl = n.toLowerCase();
      if (nl === low) starts.unshift(n);
      else if (nl.indexOf(low) === 0) starts.push(n);
      else if (nl.indexOf(low) !== -1) includes.push(n);
    });
    return starts.concat(includes);
  }

  /* 快捷胶囊：最近使用的 N 个标签 */
  function topTags(marks, n) {
    return (marks.tagOrder || []).slice(0, n || 6);
  }

  return {
    normalizeTagName: normalizeTagName,
    addTagToQuestion: addTagToQuestion,
    removeTagFromQuestion: removeTagFromQuestion,
    deleteTag: deleteTag,
    questionsForTags: questionsForTags,
    findSimilarTags: findSimilarTags,
    topTags: topTags
  };
});
