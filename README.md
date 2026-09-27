# QuizDesk —— Java Web 刷题

从夸克网盘备份（`02_课程资料与项目.7z` → `Cu/QuizDesk`）恢复的刷题项目，已重做为**纯静态网页版**，Linux/Windows/macOS 及任何服务器均可直接部署，无需后端、无需数据库。

## 目录结构

```
quizdesk/
├── resources/                      # 备份恢复的原始资料
│   ├── legacy-question-bank.json   # 题库：374 题（单选 169 / 判断 120 / 填空 85）
│   └── legacy-sources/             # 原始试卷（线上测试1~8、期中、模拟考试）
├── web/                            # 前端（静态托管或由后端托管）
│   ├── index.html / style.css / app.js
│   ├── admin.html                  # 管理后台：浏览器里更新题库
│   ├── data.js                     # 内嵌题库（无后端时的兜底数据）
│   └── data/java-web.json          # 后端首次启动的种子题库
├── server/                         # 零依赖 Node 后端（无需 npm install）
│   ├── server.js                   # 静态托管 + 题库 API + 错题同步 API
│   └── data/                       # 运行数据（题库/错题），备份=复制此目录
└── deploy/
    ├── deploy.sh                   # 一键部署（Ubuntu/Debian）
    └── 服务器部署指南.md            # 学生机购买、部署、域名备案全流程
```

## 功能

- 按来源（9 份试卷）和题型筛选，支持乱序练习
- 单选/判断点选判分，填空题输入判分（忽略大小写、空格、引号、`(1)` 类小题号，答案含 `;` 分隔的多个可接受变体）
- 即时反馈：正确答案 + 解析；答案来自学生标记未核实的题标注 ⚠；缺答案的题不计分
- 错题本（浏览器本地存储），可"只练错题"反复刷
- **服务器模式**（检测到后端自动开启）：多题库切换、错题云同步（换设备不丢）、管理后台在线更新题库
- 本轮成绩统计与进度条，手机浏览器可用

## 本地运行

题库数据内嵌在 `data.js` 中，双击 `index.html` 即可用（file:// 直接打开也能跑）。也可以：

```bash
cd quizdesk/web && python3 -m http.server 8765
# 打开 http://127.0.0.1:8765
```

## 免费部署（推荐顺序）

应用是纯静态文件，`web/` 目录里所有内容扔上任何静态托管即可，全部方案免费：

### 1. Cloudflare Pages（首选）

免费、不限流量、无需信用卡，自带 `xxx.pages.dev` 网址，国内一般可直接访问。**国内访问要求流畅时改用腾讯云 EdgeOne Pages，见下一节。**

- **零命令行**：打开 [pages.cloudflare.com](https://pages.cloudflare.com) → Create a project → Direct Upload → 把 `web/` 文件夹拖进去 → 立刻得到网址。
- **命令行**：
  ```bash
  cd quizdesk/web
  npx wrangler pages deploy . --project-name=quizdesk
  ```

### 1.5 腾讯云 EdgeOne Pages（国内访问流畅首选）

产品页 https://pages.edgeone.ai （已并入 EdgeOne Makers），控制台 https://console.cloud.tencent.com 搜「EdgeOne」。申请流程：

1. https://cloud.tencent.com 注册腾讯云账号（微信扫码最快）
2. 控制台「账号信息」→ 实名认证（个人认证，免费，几分钟）
3. 搜「EdgeOne」进 Makers/Pages，按引导开通免费计划
4. 创建项目 → Direct Upload 上传 `web/` 文件夹（或 `zip -r quizdesk-web.zip web` 打包上传）；或导入 Git 仓库，以后 `git push` 自动发布
5. 得到 `xxx.edgeone.app` 默认域名，国内直连免备案；后续接 KV 存储/边缘函数也在同一平台

### 2. GitHub Pages

推到 GitHub 仓库 → Settings → Pages → 选择分支与根目录 → 得到 `用户名.github.io/仓库名`。国内访问速度不稳定。

### 3. Vercel / Netlify

免费层对个人完全够用：

```bash
cd quizdesk/web && npx vercel        # 或 npx netlify deploy --prod --dir .
```

### 4. 以后需要后端时（多设备同步错题、账号系统）

- **Oracle Cloud Always Free**：永久免费 VPS（x86 4 核 24G 内存额度），跑任何 Linux 服务，可绑自己的域名。
- **Render**：免费 Web Service（闲置会休眠，首次访问慢几十秒）。
- **Fly.io**：有小额度免费资源。

当前版本无后端需求，先用方案 1 即可；将来加后端也不用迁移前端，静态部分原样托管在任意对象存储/CDN，接口指向你的服务器。

## 数据更新

改了题库 JSON 后重新生成内嵌数据：

```bash
python3 - <<'EOF'
import json
d = json.load(open('resources/legacy-question-bank.json'))
open('web/data.js', 'w', encoding='utf-8').write(
    'window.QUESTION_BANK=' + json.dumps(d, ensure_ascii=False) + ';\n')
EOF
```

## 题库存储 / 更新 / 访问量的分阶段方案

| 阶段 | 适用场景 | 做法 |
|---|---|---|
| 0（现状） | 更新频率低（一周一两次以内） | 题库内嵌 data.js 随站点发布，更新=跑上面脚本重新上传。零成本零运维 |
| 1 | 题库经常改、多套题库 | 题库 JSON 放 EdgeOne KV 或 COS+CDN，前端 fetch `?v=时间戳` 防缓存；更新只写数据不动站点 |
| 2 | 要账号、错题云同步、多人管理题库 | 国内轻量服务器 + nginx + SQLite + 小 API（备案域名），或 EdgeOne Functions + KV 做轻量版 |

容量参考（EdgeOne 免费版：边缘函数约 100万~300万次/月、CDN 流量 100GB/月）：

- 374 题题库 JSON 约 300KB；1 万人每天全量拉一次 ≈ 3GB/月，免费流量绑绰绰有余
- 刷题流量以小文本为主，走 CDN 边缘缓存，日几千 PV 无压力
- 大文件注意：`resources/legacy-sources/` 里 11 份试卷约 8MB，不要打进网页，放 COS+CDN 按需下载（几毛钱/GB）
