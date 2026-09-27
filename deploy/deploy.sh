#!/usr/bin/env bash
# QuizDesk 一键部署脚本 —— 适用于全新 Ubuntu/Debian 云服务器（腾讯云/阿里云轻量等）
# 用法：  sudo bash deploy.sh
# 可选：  sudo ADMIN_TOKEN=你的令牌 bash deploy.sh
set -euo pipefail

APP_DIR=/opt/quizdesk
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "请用 sudo 运行"; exit 1; }

echo "==> 1/6 安装 Node.js 与 nginx（已装则跳过）"
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 12 ]; then
  apt-get update -y && apt-get install -y nodejs
fi
command -v nginx >/dev/null || apt-get install -y nginx

echo "==> 2/6 复制程序到 ${APP_DIR}"
mkdir -p "$APP_DIR"
cp -r "$SRC_DIR/web" "$SRC_DIR/server" "$APP_DIR/"
rm -rf "$APP_DIR/server/data"   # 数据目录不覆盖，只在首次启动自动生成

echo "==> 3/6 生成管理令牌与 systemd 服务"
TOKEN="${ADMIN_TOKEN:-$(tr -dc a-zA-Z0-9 </dev/urandom | head -c 24)}"
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/quizdesk.service <<EOF
[Unit]
Description=QuizDesk quiz server
After=network.target

[Service]
WorkingDirectory=${APP_DIR}/server
ExecStart=${NODE_BIN} ${APP_DIR}/server/server.js
Environment=PORT=8901
Environment=ADMIN_TOKEN=${TOKEN}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now quizdesk

echo "==> 4/6 配置 nginx 反向代理"
cat > /etc/nginx/sites-available/quizdesk <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    # 前端静态文件
    root /opt/quizdesk/web;
    index index.html;
    gzip on;
    gzip_types application/javascript application/json text/css;

    location /api/ {
        proxy_pass http://127.0.0.1:8901;
        proxy_set_header Host $host;
    }
    location / { try_files $uri $uri/ =404; }
}
EOF
ln -sf /etc/nginx/sites-available/quizdesk /etc/nginx/sites-enabled/quizdesk
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> 5/6 预热题库（写入默认题库）"
curl -s http://127.0.0.1:8901/api/health || true

echo "==> 6/6 完成！"
echo "  访问地址:  http://<你的服务器公网IP>/"
echo "  管理后台:  http://<你的服务器公网IP>/admin.html"
echo "  管理令牌:  ${TOKEN}   （请妥善保存，也可用 ADMIN_TOKEN=xxx 重新运行本脚本覆盖）"
echo "  数据目录:  ${APP_DIR}/server/data  （备份=复制此目录）"
echo ""
echo "  提醒：腾讯云/阿里云还需在控制台【防火墙/安全组】放行 80 端口（TCP）。"
