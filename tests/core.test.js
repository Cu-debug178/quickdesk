/* QuizDesk 核心逻辑测试 —— node tests/core.test.js（零依赖，node:test 之前的写法兼容旧 Node） */
'use strict';
const assert = require('assert');
const C = require('../web/core.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' —— ' + e.message); }
}

console.log('normalizeTagName');
t('去首尾空格', () => assert.strictEqual(C.normalizeTagName('  易混淆  '), '易混淆'));
t('内部连续空白折叠为单个空格（含全角空格）', () => assert.strictEqual(C.normalizeTagName('a\u3000 b\tc'), 'a b c'));
t('超过 20 字截断', () => assert.strictEqual(C.normalizeTagName('x'.repeat(25)), 'x'.repeat(20)));
t('空白输入返回 null', () => { assert.strictEqual(C.normalizeTagName(''), null); assert.strictEqual(C.normalizeTagName('   '), null); });
t('非字符串返回 null', () => assert.strictEqual(C.normalizeTagName(null), null));

console.log('addTagToQuestion');
const empty = () => ({ tags: {}, tagOrder: [] });
t('给题目加新标签', () => {
  const r = C.addTagToQuestion(empty(), 'q1', '易混淆');
  assert.deepStrictEqual(r.tags, { '易混淆': ['q1'] });
});
t('重复加同一标签不产生重复', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '易混淆');
  r = C.addTagToQuestion(r, 'q1', '易混淆');
  assert.deepStrictEqual(r.tags['易混淆'], ['q1']);
});
t('标签名先归一化', () => {
  const r = C.addTagToQuestion(empty(), 'q1', '  易混淆  ');
  assert.ok(r.tags['易混淆']);
});
t('无效标签名返回原结构', () => {
  const r = C.addTagToQuestion(empty(), 'q1', '  ');
  assert.deepStrictEqual(r, { tags: {}, tagOrder: [] });
});
t('tagOrder 最近使用排最前', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.addTagToQuestion(r, 'q1', '乙');
  assert.deepStrictEqual(r.tagOrder, ['乙', '甲']);
});
t('再次使用旧标签提升到最前', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.addTagToQuestion(r, 'q1', '乙');
  r = C.addTagToQuestion(r, 'q2', '甲');
  assert.deepStrictEqual(r.tagOrder, ['甲', '乙']);
});

console.log('removeTagFromQuestion');
t('从题目摘掉标签', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.addTagToQuestion(r, 'q2', '甲');
  r = C.removeTagFromQuestion(r, 'q1', '甲');
  assert.deepStrictEqual(r.tags['甲'], ['q2']);
});
t('摘掉最后一题后标签自动清理', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.removeTagFromQuestion(r, 'q1', '甲');
  assert.deepStrictEqual(r.tags, {});
  assert.deepStrictEqual(r.tagOrder, []);
});
t('移除不存在的标签不报错', () => {
  const r = C.removeTagFromQuestion(empty(), 'q1', '不存在');
  assert.deepStrictEqual(r, { tags: {}, tagOrder: [] });
});

console.log('deleteTag');
t('整标签删除（含 tagOrder）', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.addTagToQuestion(r, 'q2', '甲');
  r = C.deleteTag(r, '甲');
  assert.deepStrictEqual(r.tags, {});
  assert.deepStrictEqual(r.tagOrder, []);
});

console.log('questionsForTags');
t('单标签取并集', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.addTagToQuestion(r, 'q2', '甲');
  assert.deepStrictEqual(C.questionsForTags(r, ['甲']).sort(), ['q1', 'q2']);
});
t('多标签取并集', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  r = C.addTagToQuestion(r, 'q2', '乙');
  r = C.addTagToQuestion(r, 'q3', '丙');
  assert.deepStrictEqual(C.questionsForTags(r, ['甲', '乙']).sort(), ['q1', 'q2']);
});
t('未选标签返回空集', () => {
  assert.deepStrictEqual(C.questionsForTags(empty(), []), []);
});
t('选了不存在的标签不报错', () => {
  assert.deepStrictEqual(C.questionsForTags(empty(), ['幽灵']), []);
});

console.log('findSimilarTags');
t('前缀/子串匹配，大小写不敏感', () => {
  assert.deepStrictEqual(C.findSimilarTags('SERV', ['servlet', 'jsp']), ['servlet']);
});
t('子串命中（前缀优先于子串）', () => {
  assert.deepStrictEqual(C.findSimilarTags('混', ['易混淆', '混淆题', '高频']), ['混淆题', '易混淆']);
});
t('空输入返回空', () => {
  assert.deepStrictEqual(C.findSimilarTags('', ['a', 'b']), []);
});

console.log('topTags');
t('按最近使用取前 N', () => {
  let r = empty();
  ['一', '二', '三', '四', '五', '六', '七'].forEach(n => { r = C.addTagToQuestion(r, 'q1', n); });
  assert.deepStrictEqual(C.topTags(r, 6), ['七', '六', '五', '四', '三', '二']);
});
t('不足 N 个全给', () => {
  let r = C.addTagToQuestion(empty(), 'q1', '甲');
  assert.deepStrictEqual(C.topTags(r, 6), ['甲']);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
