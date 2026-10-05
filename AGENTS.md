# QuizDesk 项目开发约定

Java Web 刷题应用。纯静态前端 + 零依赖 Node 后端，线上地址 https://cu-debug178.github.io/quickdesk/ ，代码仓库 https://github.com/Cu-debug178/quickdesk （main = 完整版，v1-static = 纯静态历史版，gh-pages = Pages 发布分支）。

## 结构

- `web/` 前端（index/admin.html + app.js/style.css + data.js 内嵌题库 + data/ 种子题库 + vendor/ 本地依赖）
- `server/` 零依赖 Node 后端（server.js；data/ 是运行数据，**不进 git**）
- `deploy/` 一键部署脚本 + 服务器指南
- `resources/` 备份恢复的原始题库与试卷

## 改动约定（每次改前端必须遵守）

1. `index.html` 里静态资源版本号必须递增（`?v=2.x`），否则线上缓存不更新
2. 改完跑 `node --check web/app.js`（或对应 js）
3. **纯逻辑一律写进 `web/core.js`（无 DOM/localStorage），并在 `tests/core.test.js` 补测试，`node tests/core.test.js` 必须全绿才能提交（TDD：先写失败测试再实现）**
4. 提交信息格式 `v2.x 中文说明`，一个功能一个提交
5. 动效统一走 `vendor/anime.min.js`，必须尊重 `prefers-reduced-motion`
6. 用户数据（重点/类别/标签/错题）存 localStorage，键名以 `quizdesk_` 开头、按题库 id 隔离，见 app.js 的 marks 模块；**不引入框架、不引入构建工具、不引入 npm 依赖**

## 部署流程（GitHub Pages）

```bash
git push origin main          # 本机直连失败时加 -c http.proxy=http://127.0.0.1:7897
git worktree add /tmp/qd-gh gh-pages
rm -rf /tmp/qd-gh/* && cp -r web/. /tmp/qd-gh/
cd /tmp/qd-gh && git add -A && git commit -m "gh-pages: 同步" && git push origin gh-pages
cd - && git worktree remove /tmp/qd-gh
```

Pages 构建约 1 分钟，验证线上：拉 `app.js?v=当前版本` 确认新代码在。

## 题库 JSON 要点

顶层 `{ bank, questions: [...] }`；题字段：`id/source/sourceType/number/type/score/stem/options/answer/analysis/questionType/answerStatus`。`answerStatus`: official（官方）/ student_marked_unverified（界面标 ⚠）/ missing（不计分）。判断题 options 形如 `["A. 对","B. 错"]`；填空题 answer 可含 `;` 分隔多变体与 `(1)` 小题号。
