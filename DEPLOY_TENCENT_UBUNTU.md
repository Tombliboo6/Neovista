# NeoVista 腾讯云 Ubuntu 部署指南

## 系统要求
- Ubuntu 20.04/22.04
- **Python 3.8+**（项目使用 `Optional[X]` 语法，兼容 Python 3.8+）
- Node.js 20 LTS
- 2核2GB 内存（最低配置）

## 部署用户说明
本文档默认使用 **ubuntu** 用户进行部署（腾讯云 Ubuntu 镜像默认用户）。

如果你的服务器默认用户不是 `ubuntu`（例如 `root`、`admin`、`ec2-user` 等），需要同步修改：
1. `deploy/systemd/neovista-api.service` 中的 `User=` 和 `Group=`
2. 所有涉及 `chown ubuntu:ubuntu` 的命令改为你的实际用户名

---

## 1. 安装系统依赖

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装基础工具
sudo apt install -y git curl nginx python3 python3-pip python3-venv

# 验证 Python 版本（必须 3.8+）
python3 --version

# 安装 Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version     # 应该是 v20.x
npm --version
```

---

## 2. 创建数据目录

```bash
# 创建独立数据目录（与代码分离）
sudo mkdir -p /var/lib/neovista
sudo chown ubuntu:ubuntu /var/lib/neovista
sudo chmod 755 /var/lib/neovista
```

---

## 3. 克隆项目

```bash
# 创建 Web 目录
sudo mkdir -p /var/www
cd /var/www

# 克隆代码
sudo git clone https://github.com/wzhoudargon/Neovista.git neovista

# 修改权限（使用 ubuntu 用户）
sudo chown -R ubuntu:ubuntu /var/www/neovista

# 确认当前部署主线是 main
cd /var/www/neovista
git checkout main
```

**当前仓库约定：**
- GitHub `main` 是当前唯一部署主线
- 服务器工作树也跟踪 `origin/main`
- 旧的 `deploy-snapshot`、`release/billing-sync` 仅作为历史回滚参考，不再作为日常发布入口

---

## 4. 配置后端

```bash
cd /var/www/neovista/backend

# 确保 static 目录存在（双重保险）
mkdir -p static

# 创建虚拟环境
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
nano .env

# 初始化账本相关表（首次部署付费系统时执行）
python migrate_billing_schema.py
```

**必须修改的环境变量：**
```env
ADMIN_SECRET_KEY=生成一个随机密钥
CORS_ALLOW_ORIGINS=https://neotest.site,https://www.neotest.site
DATABASE_URL=sqlite:////var/lib/neovista/neovista.db
API_CHANNEL_1_API_KEY=你的真实API密钥
CHAT_FLASH_CHANNEL_1_API_KEY=你的聊天 Flash 渠道密钥
CHAT_PRO_CHANNEL_1_API_KEY=你的聊天 Pro 渠道密钥
```

**推荐同时检查的聊天渠道配置：**
```env
CHAT_FLASH_CHANNEL_1_NAME=Flash1
CHAT_FLASH_CHANNEL_1_BASE_URL=https://your-chat-host.com
CHAT_FLASH_CHANNEL_1_MODEL=gemini-3.1-flash-lite-preview

CHAT_PRO_CHANNEL_1_NAME=Pro1
CHAT_PRO_CHANNEL_1_BASE_URL=https://your-chat-host.com
CHAT_PRO_CHANNEL_1_MODEL=gemini-3.1-pro-preview
```

**账单 / 限流相关建议变量：**
```env
CREDITS_PER_YUAN=100
WELCOME_CREDITS=200
REGISTER_IP_DAILY_LIMIT=3
SEND_CODE_IP_HOURLY_LIMIT=10
FREE_CHAT_DAILY_LIMIT=30
FREE_AGENT_CHAT_DAILY_LIMIT=5
```

**变量说明：**
- `API_CHANNEL_*`：最终生图渠道，按顺序容灾切换
- `CHAT_FLASH_CHANNEL_*`：普通聊天渠道，工作区 `Agent` 关闭时走这里
- `CHAT_PRO_CHANNEL_*`：深度分析/Agent 渠道，工作区 `Agent` 开启与审图都走这里
- 工作区聊天规则：`Agent 关闭 -> Flash`，`Agent 开启 -> Pro`
- 如果你的中转站要求特殊模型名，例如 `gemini-3.1-pro`，以中转站文档为准

**设置 .env 文件权限（防止密钥泄露）：**
```bash
chmod 600 /var/www/neovista/backend/.env
```

**首次数据库初始化：**
```bash
# 确保在 venv 环境中
source .venv/bin/activate

# 启动一次后端，会自动创建数据库表
uvicorn main:app --host 127.0.0.1 --port 8000

# 看到以下输出表示成功：
# ✅ 数据库类型: sqlite
# ✅ CORS 允许的源: ['https://neotest.site', 'https://www.neotest.site']
# Application startup complete.

# 验证数据库文件已创建
ls -lh /var/lib/neovista/neovista.db

# 测试健康检查
curl http://127.0.0.1:8000/api/health
# 应该返回：{"status":"ok","timestamp":"..."}

# 测试通过后按 Ctrl+C 停止
```

---

## 5. 配置前端

```bash
cd /var/www/neovista/frontend

# 安装依赖
npm install

# 构建生产版本
npm run build

# 验证构建产物
ls -lh dist/
# 应该看到 index.html 和 assets/ 目录
```

**工作区聊天开关语义：**
- `Agent` 关闭：工作区聊天走 Flash 渠道
- `Agent` 开启：工作区聊天走 Pro 渠道
- 审图接口始终走 Pro 渠道

---

## 6. 配置 systemd 服务

```bash
# 复制 service 文件
sudo cp /var/www/neovista/deploy/systemd/neovista-api.service /etc/systemd/system/

# 如果你的用户不是 ubuntu，需要先修改 service 文件
# sudo nano /etc/systemd/system/neovista-api.service
# 将 User=ubuntu 和 Group=ubuntu 改为你的实际用户名

# 重载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start neovista-api

# 查看状态
sudo systemctl status neovista-api
# 应该看到 "Active: active (running)"

# 设置开机自启
sudo systemctl enable neovista-api

# 查看日志（确认环境变量加载成功）
sudo journalctl -u neovista-api -n 50
# 应该看到：
# ✅ CORS 允许的源: [...]
# ✅ 数据库类型: sqlite
```

**systemd 网络依赖说明：**
service 文件使用 `Wants=network-online.target` 和 `After=network-online.target`，确保网络完全就绪后再启动服务，避免启动过早导致 API 调用失败。

---

## 7. 配置 Nginx

```bash
# 删除默认站点（避免冲突）
sudo rm -f /etc/nginx/sites-enabled/default

# 复制配置文件
sudo cp /var/www/neovista/deploy/nginx/neovista.conf /etc/nginx/sites-available/

# 创建软链接
sudo ln -s /etc/nginx/sites-available/neovista.conf /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t
# 应该看到 "syntax is ok" 和 "test is successful"

# 重启 Nginx
sudo systemctl restart nginx
```

---

## 8. 配置防火墙

```bash
# 开放端口
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

**同时在腾讯云控制台配置安全组：**
- 入站规则：开放 22、80、443 端口

---

## 9. 配置 HTTPS

```bash
# 安装 certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书（替换为你的域名）
sudo certbot --nginx -d neotest.site -d www.neotest.site

# 测试自动续期
sudo certbot renew --dry-run
```

---

## 10. 验证部署

```bash
# 测试后端健康检查
curl http://127.0.0.1:8000/api/health
# 返回：{"status":"ok","timestamp":"..."}

# 测试 Nginx 代理
curl http://neotest.site/api/health
# 返回：{"status":"ok","timestamp":"..."}

# 测试 HTTPS
curl https://neotest.site/api/health
# 返回：{"status":"ok","timestamp":"..."}

# 测试后端静态文件（如果有）
curl https://neotest.site/static/test.png

# 浏览器访问
# https://neotest.site
```

---

## 11. 付费系统上线清单

```bash
# 1) 先备份生产数据库
cp /var/lib/neovista/neovista.db /var/lib/neovista/neovista.db.bak.$(date +%Y%m%d-%H%M%S)

# 2) 激活后端环境并执行账单迁移
cd /var/www/neovista/backend
source .venv/bin/activate
python migrate_billing_schema.py   # 可重复执行，适合上线前再次确认

# 3) 重启后端服务
sudo systemctl restart neovista-api

# 4) 查看启动日志，确认账单 / 限流配置已生效
sudo journalctl -u neovista-api -n 80 --no-pager
```

上线前至少确认：
- 已跑过 `migrate_billing_schema.py`
- `.env` 已配置 `WELCOME_CREDITS`、聊天/生图渠道和限流变量
- 已预先生成一批兑换码，再向用户开放充值入口

内测环境建议再做一次最小冒烟：
- 新注册账号是否收到 200 点欢迎积分
- `/api/v1/billing/me` 是否能看到余额和流水
- 管理员生成兑换码后，`admin_audit_logs` 是否有 `GENERATE_REDEMPTION_CODES`
- 触发一次可控失败生图后，是否出现 `GENERATE_REFUND`
- 同一用户再次正常生图时，余额是否继续正确扣减

---

## 12. 老用户余额回填建议

首次上线账本系统时，如果数据库里已经存在老用户与历史 `credits` 余额，建议执行一次“只补流水、不清余额”的回填。

原则：
- 不清零老用户现有 `users.credits`
- 为每个已有余额的用户补一条 `ADMIN_ADJUST` 或 `WELCOME_GRANT` 流水
- `balance_after` 直接写回填时的现有余额

推荐做法：
1. 先备份数据库
2. 在维护窗口内执行一次性脚本
3. 脚本只为“当前有余额、但还没有账本记录”的用户补流水
4. 回填后抽查 3-5 个账号，确认前端余额和账单历史一致

---

## 13. 兑换码与运营观察项

### 生成兑换码

系统已提供管理员接口 `POST /api/v1/billing/admin/redemption-codes`。  
建议在正式开放充值前，先生成至少一批测试码和一批正式码。

建议字段：
- `credits`：单张兑换码到账算力点
- `count`：一次生成多少张
- `batch`：例如 `wechat-2026-04`
- `expires_days`：MVP 阶段可先留空不过期

### 上线后重点观察

- `GENERATE_REFUND` 的数量是否异常升高
- `429` 是否主要集中在 `send-code`、`register`、`workspace-chat`
- 兑换码失败率是否升高
- 活跃用户平均余额是否持续过低

常用排查命令：
```bash
sudo journalctl -u neovista-api -f
sqlite3 /var/lib/neovista/neovista.db "select type,status,count(*) from credit_transactions group by type,status;"
sqlite3 /var/lib/neovista/neovista.db "select action,count(*) from usage_counters group by action;"
```

---

## 常用运维命令

```bash
# 查看后端日志
sudo journalctl -u neovista-api -f

# 重启后端
sudo systemctl restart neovista-api

# 重启 Nginx
sudo systemctl restart nginx

# 更新代码
cd /var/www/neovista
git checkout main
git pull --ff-only origin main
cd backend && source .venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install && npm run build
sudo systemctl restart neovista-api
sudo systemctl reload nginx

# 备份数据库
cp /var/lib/neovista/neovista.db ~/backup/neovista-$(date +%Y%m%d).db
```

**推荐发布顺序：**
1. 本地在 `Neovista2.0/main` 完成开发并推送到 GitHub `main`
2. 服务器执行上面的“更新代码”命令
3. 如涉及数据库结构或账本字段，额外执行 `python migrate_billing_schema.py`
4. 用 `curl https://neotest.site/api/health` 和浏览器手工冒烟确认上线结果

---

## 故障排查

### 后端无法启动
```bash
# 查看详细日志
sudo journalctl -u neovista-api -n 100 --no-pager

# 检查 .env 文件权限
ls -la /var/www/neovista/backend/.env
# 应该是 -rw------- (600)

# 检查 static 目录是否存在
ls -la /var/www/neovista/backend/static/

# 手动测试
cd /var/www/neovista/backend
source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8000
```

### CORS 错误
```bash
# 检查环境变量是否加载
sudo journalctl -u neovista-api | grep CORS

# 检查 .env 文件
cat /var/www/neovista/backend/.env | grep CORS

# 重启服务
sudo systemctl restart neovista-api
```

### 数据库无法写入
```bash
# 检查数据目录权限
ls -la /var/lib/neovista/

# 修复权限
sudo chown ubuntu:ubuntu /var/lib/neovista/neovista.db
sudo chmod 644 /var/lib/neovista/neovista.db
```

### 图片上传 413 错误
```bash
# 检查 Nginx 配置
grep client_max_body_size /etc/nginx/sites-available/neovista.conf

# 如果需要更大限制，修改配置后重启
sudo nano /etc/nginx/sites-available/neovista.conf
sudo nginx -t
sudo systemctl reload nginx
```

### /static/ 路由 404
```bash
# 检查 Nginx 配置中 /static/ 是否使用 ^~ 前缀
grep "location.*static" /etc/nginx/sites-available/neovista.conf

# 测试后端静态文件是否可访问
curl http://127.0.0.1:8000/static/test.png

# 检查 Nginx 日志
sudo tail -f /var/log/nginx/error.log
```

---

## 性能监控

```bash
# 安装监控工具
sudo apt install htop

# 实时监控
htop

# 查看内存使用
free -h

# 查看磁盘使用
df -h

# 查看后端进程
ps aux | grep uvicorn
```

---

## 数据库说明

### 自动初始化
项目使用 SQLAlchemy ORM，首次启动时会自动执行：
```python
Base.metadata.create_all(bind=engine)
```
这会在 `/var/lib/neovista/neovista.db` 创建所有必要的表。

### 备份策略
```bash
# 每日备份（建议添加到 crontab）
0 2 * * * cp /var/lib/neovista/neovista.db /var/backups/neovista-$(date +\%Y\%m\%d).db
```

### 迁移到 PostgreSQL（可选）
如果后续用户量增长，可以迁移到 PostgreSQL：
1. 安装 PostgreSQL
2. 导出 SQLite 数据
3. 修改 `.env` 中的 `DATABASE_URL`
4. 重启服务

---

## 安全检查清单

- [ ] `.env` 文件权限为 600
- [ ] `.env` 已添加到 `.gitignore`
- [ ] `backend/static/` 目录存在
- [ ] CORS_ALLOW_ORIGINS 已改为生产域名
- [ ] ADMIN_SECRET_KEY 已更换为随机密钥
- [ ] 腾讯云安全组已开放 80、443 端口
- [ ] ufw 防火墙已启用
- [ ] HTTPS 证书已配置
- [ ] 数据库定期备份
