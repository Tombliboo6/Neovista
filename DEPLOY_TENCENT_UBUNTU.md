# NeoVista 腾讯云 Ubuntu 部署指南

## 当前部署源
- GitHub 仓库：`git@github.com:wzhoudargon/Neovista.git`
- 推荐部署分支：`deploy-snapshot`
- 本文档以下命令默认以 `deploy-snapshot` 分支为准

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
sudo chown ubuntu:ubuntu /var/www
cd /var/www

# 使用 ubuntu 用户克隆 deploy-snapshot 分支
git clone --depth 1 --branch deploy-snapshot git@github.com:wzhoudargon/Neovista.git neovista

# 如果服务器没有配置 GitHub SSH Key，可以改用 HTTPS：
# git clone --depth 1 --branch deploy-snapshot https://github.com/wzhoudargon/Neovista.git neovista

# 确认当前代码分支
cd /var/www/neovista
git branch --show-current
# 应该看到：deploy-snapshot
```

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
```

**必须修改的环境变量：**
```env
ADMIN_SECRET_KEY=生成一个随机密钥
CORS_ALLOW_ORIGINS=https://neotest.site,https://www.neotest.site
DATABASE_URL=sqlite:////var/lib/neovista/neovista.db
API_CHANNEL_1_API_KEY=你的真实API密钥
```

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
git pull
cd backend && source .venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install && npm run build
sudo systemctl restart neovista-api
sudo systemctl reload nginx

# 备份数据库
cp /var/lib/neovista/neovista.db ~/backup/neovista-$(date +%Y%m%d).db
```

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
