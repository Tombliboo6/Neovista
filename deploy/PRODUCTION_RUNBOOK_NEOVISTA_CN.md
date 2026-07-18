# NeoVista 阿里云生产发布运行手册

适用域名：`neovista.cn`、`www.neovista.cn`、`api.neovista.cn`  
应用目录：`/var/www/neovista`  
服务用户：`ecs-user`  
生产数据库：`/var/lib/neovista/neovista.db`

本文只覆盖阿里云生产站。所有命令均不得引用旧测试域名、香港回源或旧云主机。

## 1. 发布不变量

任一条件不满足，立即停止发布：

- Nginx 是唯一公网入口，Uvicorn 只监听 `127.0.0.1:8000`，且只有一个进程。
- Seedance reconciler 只在该 Uvicorn 进程内运行；禁止额外 worker 或第二个 reconciler。
- `.env` 与数据库均为 `ecs-user:ecs-user 0600`。不得在终端、日志、清单中打印密钥、JWT、邮箱、prompt、data URI 或签名结果 URL。
- `JWT_SECRET_KEY` 与 `ADMIN_SECRET_KEY` 均至少 32 字符、互不相同且不是占位符。
- 第一阶段必须同时保持 `IMAGE_GENERATION_FEATURE_ENABLED=false` 与 `SEEDANCE_FEATURE_ENABLED=false`。
- 迁移固定顺序是 `billing -> video -> image`。迁移前停止 Nginx 和 API，确认没有游离 Uvicorn、8000 监听或 DB/WAL/SHM holder，再做 SQLite `.backup`。
- readiness 必须为 HTTP 200、`status=ready` 且全部 `checks=true`；`degraded` 不可开放。
- 迁移是 forward-only。回滚时旧代码、旧 venv、旧 systemd unit 与迁移前 DB 必须成对恢复。
- 候选代码只接受随制品生成、随后安装为 `root:root 0600` 的 SHA-256 清单；线上文件集合与摘要必须完全一致。
- 生产备份只进入 `root:root 0700` 的 `/var/backups/neovista/releases`；测试状态只进入 `/var/backups/neovista/smoke`。
- 唯一付费烟测上限恰好为：1 张 Nano Banana 2、1K 生图 30 点，加 1 个 Seedance 2.0、5 秒、720p 视频 1250 点，合计恰好 1280 点。
- 同一次烟测永远复用持久化的 image/video request ID。只有原视频被供应商明确拒绝、没有 provider task ID 且 1250 点完整唯一退款时，脚本才可在同一 `SMOKE_RUN_ID` 下派生固定的 `-a2` 视频 attempt；请求不明、进程中断或供应商终态未知时绝不派生新 ID。

## 2. 维护窗口前：构建不可变候选与 venv

候选目录必须已经通过后端、前端、迁移演练和安全扫描。候选包不得包含 `.env`、数据库、密钥、venv 或 `backend/static`。在候选根目录生成清单：

```bash
set -Eeuo pipefail
export RELEASE_CODE_REF='填写已验收的commit或不可变artifact-ID'
export CANDIDATE_DIR="/var/tmp/neovista-candidate-$RELEASE_CODE_REF"

test -d "$CANDIDATE_DIR/backend"
test -d "$CANDIDATE_DIR/frontend/dist"
test -d "$CANDIDATE_DIR/deploy"
APP_ROOT="$CANDIDATE_DIR" OUTPUT="$CANDIDATE_DIR/SHA256SUMS" \
  "$CANDIDATE_DIR/deploy/scripts/build-neovista-release-manifest.sh"
(cd "$CANDIDATE_DIR" && sha256sum -c SHA256SUMS)

# 把已测试清单固定到 root-only 位置，避免上传目录之后被替换。
sudo install -d -m 700 -o root -g root /var/backups/neovista/releases/manifests
export EXPECTED_CANDIDATE_MANIFEST="/var/backups/neovista/releases/manifests/$RELEASE_CODE_REF.SHA256SUMS"
sudo install -m 600 -o root -g root \
  "$CANDIDATE_DIR/SHA256SUMS" "$EXPECTED_CANDIDATE_MANIFEST"
sudo test "$(sudo stat -c '%U:%G:%a' "$EXPECTED_CANDIDATE_MANIFEST")" = root:root:600
```

在旧生产仍运行时预构建候选 venv，避免维护窗口依赖网络安装，也不要覆盖当前 `.venv`：

```bash
export CANDIDATE_VENV="/var/lib/neovista/venvs/$RELEASE_CODE_REF"
sudo test ! -e "$CANDIDATE_VENV"
sudo install -d -m 755 -o root -g root /var/lib/neovista/venvs
sudo python3 -m venv "$CANDIDATE_VENV"
sudo "$CANDIDATE_VENV/bin/python" -m pip install --upgrade pip==26.1.2
sudo "$CANDIDATE_VENV/bin/python" -m pip install \
  -r "$CANDIDATE_DIR/backend/requirements.txt"
sudo "$CANDIDATE_VENV/bin/python" -m pip check
sudo "$CANDIDATE_VENV/bin/python" - <<'PY'
import bcrypt, cryptography, fastapi, httpx, jwt, PIL, pydantic, sqlalchemy, uvicorn
PY
sudo chown -R root:root "$CANDIDATE_VENV"
sudo chmod -R go-w "$CANDIDATE_VENV"
sudo test -z "$(sudo find "$CANDIDATE_VENV" -xdev ! -type l \( ! -user root -o -perm /022 \) -print -quit)"
```

## 3. 维护窗口前：保存当前可执行版本

线上是 artifact 部署，不能假设存在 Git。旧代码、前端、真实 Nginx/systemd 配置要保存到 root-only 目录；`.env`、mutable static、DB 和 venv 不复制进 artifact 目录：

```bash
set -Eeuo pipefail
cd /var/www/neovista
export PREVIOUS_ARTIFACT_DIR="/var/backups/neovista/releases/artifacts/before-$RELEASE_CODE_REF-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 -o root -g root \
  "$PREVIOUS_ARTIFACT_DIR" \
  "$PREVIOUS_ARTIFACT_DIR/backend" \
  "$PREVIOUS_ARTIFACT_DIR/frontend-dist"
sudo rsync -a --delete \
  --exclude='.env' --exclude='.venv' --exclude='.venv-current' --exclude='static' \
  --exclude='*.db' --exclude='*.sqlite' --exclude='*.pem' --exclude='*.key' \
  --exclude='__pycache__' --exclude='.pytest_cache' \
  backend/ "$PREVIOUS_ARTIFACT_DIR/backend/"
sudo rsync -a --delete frontend/dist/ "$PREVIOUS_ARTIFACT_DIR/frontend-dist/"
sudo install -m 600 -o root -g root /etc/nginx/sites-available/neovista \
  "$PREVIOUS_ARTIFACT_DIR/nginx.previous"
sudo install -m 600 -o root -g root /etc/systemd/system/neovista-api.service \
  "$PREVIOUS_ARTIFACT_DIR/neovista-api.previous"
if test -L /var/www/neovista/backend/.venv-current; then
  readlink -f /var/www/neovista/backend/.venv-current \
    | sudo tee "$PREVIOUS_ARTIFACT_DIR/previous-venv-target.txt" >/dev/null
else
  realpath /var/www/neovista/backend/.venv \
    | sudo tee "$PREVIOUS_ARTIFACT_DIR/previous-venv-target.txt" >/dev/null
fi
sudo chmod 600 "$PREVIOUS_ARTIFACT_DIR/previous-venv-target.txt"
sudo sh -c "cd '$PREVIOUS_ARTIFACT_DIR' && \
  { find backend frontend-dist -type f -print0; printf '%s\\0' nginx.previous neovista-api.previous; } \
  | { cat; printf '%s\\0' previous-venv-target.txt; } \
  | sort -z | xargs -0 sha256sum >SHA256SUMS && chmod 600 SHA256SUMS && sha256sum -c SHA256SUMS"
```

在维护窗口前只补齐/修改下列非密钥生产键；不得复制、替换或回显任何 API key：

```dotenv
NEOVISTA_ENV=production
DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false
IMAGE_GENERATION_FEATURE_ENABLED=false
SEEDANCE_FEATURE_ENABLED=false
SEEDANCE_RECONCILER_ENABLED=true
PUBLIC_BASE_URL=https://neovista.cn
SEEDANCE_REFERENCE_ALLOWED_HOSTS=neovista.cn
SEEDANCE_REFERENCE_GC_ENABLED=true
SEEDANCE_REFERENCE_TTL_SECONDS=86400
API_CHANNEL_1_PRODUCT_MODEL=nano-banana-2
API_CHANNEL_2_PRODUCT_MODEL=nano-banana-2
API_CHANNEL_3_PRODUCT_MODEL=nano-banana-pro
API_CHANNEL_4_PRODUCT_MODEL=gpt-image-2
```

使用候选制品内的 allowlist 脚本原子更新上述值并生成 root-only 备份；该脚本不会改写或输出任何 API key、渠道 Base URL、JWT 或管理员密钥。它只额外把 channel 3 的非密供应商模型标识修正为已审核的 `nano-banana-pro`：

```bash
sudo env NEOVISTA_ENV_UPDATE_CONFIRMED=YES RELEASE_CODE_REF="$RELEASE_CODE_REF" \
  "$CANDIDATE_DIR/deploy/scripts/update-neovista-production-env.sh" --execute
```

同时确认 channel 3 的供应商 model 是已验证的 `nano-banana-pro`。这里只是“产品模型 → 供应商模型”的路由映射，不改变可信中转渠道，也不把 Base URL/key 抄到命令或文档。

零成本预检：

```bash
test "$(stat -c '%U:%G:%a' /var/www/neovista/backend/.env)" = ecs-user:ecs-user:600
test "$(stat -c '%U:%G:%a' /var/lib/neovista/neovista.db)" = ecs-user:ecs-user:600
grep -qx 'IMAGE_GENERATION_FEATURE_ENABLED=false' /var/www/neovista/backend/.env
grep -qx 'SEEDANCE_FEATURE_ENABLED=false' /var/www/neovista/backend/.env
grep -qx 'NEOVISTA_ENV=production' /var/www/neovista/backend/.env
grep -qx 'DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false' /var/www/neovista/backend/.env
grep -qx 'SEEDANCE_RECONCILER_ENABLED=true' /var/www/neovista/backend/.env
grep -qx 'PUBLIC_BASE_URL=https://neovista.cn' /var/www/neovista/backend/.env
grep -qx 'SEEDANCE_REFERENCE_ALLOWED_HOSTS=neovista.cn' /var/www/neovista/backend/.env
grep -qx 'SEEDANCE_REFERENCE_GC_ENABLED=true' /var/www/neovista/backend/.env
grep -qx 'SEEDANCE_REFERENCE_TTL_SECONDS=86400' /var/www/neovista/backend/.env
sqlite3 -bail /var/lib/neovista/neovista.db 'PRAGMA integrity_check;'
sqlite3 -bail /var/lib/neovista/neovista.db 'PRAGMA foreign_key_check;'

# 兼容尚无 reference_paths 的旧 schema，只预览、不删除。
APP_ROOT=/var/www/neovista DATABASE_PATH=/var/lib/neovista/neovista.db \
  "$CANDIDATE_DIR/deploy/scripts/cleanup-seedance-references.sh" --dry-run --ttl-hours 24
```

还需人工确认：

- 根域、`www`、`api` 的 DNS A 记录都直指当前阿里云公网 IP，没有 CDN/香港站回源。
- TLS SAN 覆盖三个域名，磁盘至少有 DB 三倍空间，inode、内存、时钟正常。
- 每个 `API_CHANNEL_N_PRODUCT_MODEL` 都明确表达产品模型到供应商模型的“模型路由映射”；Base URL、key 与 provider model 只检查存在性，不回显值。
- 测试账户至少 1280 点，无与本次 smoke ID 无关的 active/review task。
- 历史 `submitted/running/submit_unknown/reconciliation_required` 均有供应商证据；不得为了过门禁直接改状态或退款。
- `/gallery/` 当前使用稳定文件名而非内容哈希。正式 vhost 已将新响应降为 1 小时、`must-revalidate`、非 `immutable`；但浏览器此前取得的一年期 immutable 响应不会被服务器新规则主动清除。本次同名素材优化上线前，前端 URL 必须带新的发布版本查询串/版本目录，或接受旧客户端最长继续使用旧缓存到原到期日。

## 4. 进入维护窗口并迁移

先停止公网和 API，再覆盖候选文件。不要在线修改旧 venv：

```bash
set -Eeuo pipefail
sudo systemctl stop nginx neovista-api
! systemctl is-active --quiet nginx
! systemctl is-active --quiet neovista-api

sudo rsync -a --delete \
  --exclude='.env' --exclude='.venv' --exclude='.venv-current' --exclude='static' \
  --exclude='*.db' --exclude='*.sqlite' --exclude='*.pem' --exclude='*.key' \
  --exclude='__pycache__' --exclude='.pytest_cache' \
  "$CANDIDATE_DIR/backend/" /var/www/neovista/backend/
sudo rsync -a --delete "$CANDIDATE_DIR/frontend/dist/" /var/www/neovista/frontend/dist/
sudo rsync -a --delete "$CANDIDATE_DIR/deploy/" /var/www/neovista/deploy/
sudo chmod 755 /var/www/neovista/deploy/scripts/*.sh

sudo env \
  NEOVISTA_MAINTENANCE_CONFIRMED=YES \
  RELEASE_CODE_REF="$RELEASE_CODE_REF" \
  PREVIOUS_ARTIFACT_DIR="$PREVIOUS_ARTIFACT_DIR" \
  EXPECTED_CANDIDATE_MANIFEST="$EXPECTED_CANDIDATE_MANIFEST" \
  CANDIDATE_VENV="$CANDIDATE_VENV" \
  /var/www/neovista/deploy/scripts/migrate-neovista-production.sh --execute
```

如果这是同一次发布在迁移闸门失败后的重跑，必须额外传入首次运行生成的旧库快照，防止把重跑前的前向迁移库误标成旧代码的回滚配对。脚本会验证它与同一旧 artifact/venv 配对，并复制进本次 root-only 回滚包：

```bash
export CANONICAL_ROLLBACK_DATABASE_BACKUP=/var/backups/neovista/releases/<first-run>/neovista.db
```

重跑时把它明确放进 `sudo env` 参数：

```bash
sudo env \
  CANONICAL_ROLLBACK_DATABASE_BACKUP="$CANONICAL_ROLLBACK_DATABASE_BACKUP" \
  NEOVISTA_MAINTENANCE_CONFIRMED=YES \
  RELEASE_CODE_REF="$RELEASE_CODE_REF" \
  PREVIOUS_ARTIFACT_DIR="$PREVIOUS_ARTIFACT_DIR" \
  EXPECTED_CANDIDATE_MANIFEST="$EXPECTED_CANDIDATE_MANIFEST" \
  CANDIDATE_VENV="$CANDIDATE_VENV" \
  /var/www/neovista/deploy/scripts/migrate-neovista-production.sh --execute
```

脚本会执行并验证：

1. 已安装文件集合与 root-only 候选清单完全一致。
2. 停 Nginx/API 后没有游离 Uvicorn、8000 listener 或 DB/WAL/SHM holder。
3. 在 `/var/backups/neovista/releases/<release-id>` 创建 WAL-safe `.backup`。
4. 按 `billing -> video -> image` 迁移，并验证完整性、外键和关键唯一索引，包含 `ix_chat_sessions_user_id`。
5. 递归删除 24 小时以上且未被 active/review 引用的参考图，再验证 `eligible=0`。
6. 原子切 `.venv-current` 到预构建候选 venv，安装 API 与 root cleanup timer unit。
7. 只启动本机 API并通过严格 readiness；**Nginx 仍保持停止**。

成功文本必须包含 `Nginx remains stopped`。此时公网仍未开放。

## 5. 历史任务与账务门禁

图像迁移可能把历史孤儿 hold 投影为 `reconciliation_required/REVIEW_REQUIRED`。必须使用供应商账单、结果记录和余额证据逐条 `capture` 或 `refund`；无法确认就继续 REVIEW_REQUIRED。管理员结算必须同时带登录管理员 Bearer 与 `X-Admin-Token`，审计身份不接受请求体自报。

若迁移脚本因此停止，它已经安装候选 unit 与 `.venv-current`，失败处理只对公网启动 hard-maintenance 503、API 保持 stopped。可在不开放公网的情况下启动候选 API 做本机结算：

```bash
grep -qx 'IMAGE_GENERATION_FEATURE_ENABLED=false' /var/www/neovista/backend/.env
grep -qx 'SEEDANCE_FEATURE_ENABLED=false' /var/www/neovista/backend/.env
sudo systemctl start neovista-api
curl -fsS http://127.0.0.1:8000/api/health | jq .
# 此时 /api/ready 因历史 review backlog 返回 503 是预期行为；退款完成后才要求 200 ready。
# 按下述双重管理员认证逐条处理；完成后：
sudo systemctl stop neovista-api
# 使用完全相同的 RELEASE_CODE_REF、PREVIOUS_ARTIFACT_DIR、manifest 和 candidate venv
# 重跑第 4 节迁移命令。previous-venv-target.txt 始终指向真正发布前 venv。
```

历史 Seedance 必须满足：

- `submitted/running` 最终成为 `succeeded + CAPTURED` 或 `failed + REFUNDED`。
- 提交终态不明时保持 `reconciliation_required + REVIEW_REQUIRED`，不得重放或猜测退款。
- 每任务一个 hold，成功一个 capture，失败一个 refund。
- 默认 `/api/v1/admin/video/reviews` 与 `/api/v1/admin/image/reviews` 都处理为 0；否则不开放公网。

所有管理请求只走 `127.0.0.1:8000`。header 文件必须先创建再 `chmod`：

```bash
HEADER_FILE="$(mktemp)"
touch "$HEADER_FILE"
chmod 600 "$HEADER_FILE"
trap 'rm -f -- "$HEADER_FILE"' EXIT
read -rsp '管理员 Bearer JWT: ' ADMIN_JWT; echo
read -rsp 'ADMIN_SECRET_KEY: ' ADMIN_TOKEN; echo
printf 'Authorization: Bearer %s\nX-Admin-Token: %s\n' "$ADMIN_JWT" "$ADMIN_TOKEN" >"$HEADER_FILE"
unset ADMIN_JWT ADMIN_TOKEN
curl -fsS http://127.0.0.1:8000/api/v1/admin/video/reviews --header @"$HEADER_FILE" | jq '{count}'
curl -fsS http://127.0.0.1:8000/api/v1/admin/image/reviews --header @"$HEADER_FILE" | jq '{count}'
```

## 6. 唯一一次 1280 点生产烟测

只有前五节全部通过后，才把两个非密钥开关同时改为 true：

```bash
sudo systemctl stop nginx
sudoedit /var/www/neovista/backend/.env
# 只修改：
# IMAGE_GENERATION_FEATURE_ENABLED=true
# SEEDANCE_FEATURE_ENABLED=true
sudo systemctl restart neovista-api

curl -fsS http://127.0.0.1:8000/api/ready \
  | jq -e '.status == "ready" and ([.checks[]] | all)'
curl -fsS http://127.0.0.1:8000/api/v1/image/capabilities | jq -e '.enabled == true'
curl -fsS http://127.0.0.1:8000/api/v1/video/capabilities | jq -e '.enabled == true'

export SMOKE_RUN_ID="$RELEASE_CODE_REF"
sudo env NEOVISTA_PAID_SMOKE_CONFIRMED=YES SMOKE_RUN_ID="$SMOKE_RUN_ID" \
  /var/www/neovista/deploy/scripts/smoke-neovista-production.sh --execute
```

烟测脚本的防重复语义：

- 在 `/var/backups/neovista/smoke/$SMOKE_RUN_ID/state.env` 固定 image/video request ID，`root:root 0600`，中断也不删除；符合严格前置条件的 `-a2` 另写 append-only 的 `video-attempt-a2.env` 和 attempt-scoped 证据文件，绝不覆盖 attempt 1。
- 每次调用前查 task、ledger 和 generation event。已有成功任务只做同 ID/同 payload replay；active/unknown/review 时停止，不发第二次请求。
- attempt 1 只有同时满足 `failed/REFUNDED`、`provider_task_id IS NULL`、原 request 恰好一条 -1250 hold、一条 +1250 refund、零 capture、唯一 `SEEDANCE_CREATE_REJECTED` event 时才允许 deterministic `-a2`；`-a2` 若再次失败则永久停止，不存在 `-a3`。
- 若视频已终态，但终态前没有完整持久化 reference state 与 GET/HEAD/POST evidence，脚本 fail-closed：不从已清空的 DB 路径猜测，也不新建付费请求。只能另做不调用供应商的独立参考网关探针并人工处置。
- 第一次 1K 生图结果直接作为唯一被供应商接受的 Seedance 视频的 `first_frame`，不再生成或上传第二张图。
- 正常路径要求生图、视频各一个 hold/capture；严格退款重试路径要求生图 hold/capture、attempt 1 hold/refund、attempt 2 hold/capture。两条路径最终关联流水净消耗都必须恰好 1280 点，replay 前后 active attempt 的 task/transaction 数不变。
- 图片参考 data URI 会落为临时 `https://neovista.cn/static/seedance_references/<uuid>`。因此视频 smoke 期间只短暂启动 `neovista-cn-smoke-reference.conf`：根域只开放该路径 GET/HEAD，页面/API 全 503，API 子域参考图 404。付费 API 始终只走 localhost。
- 真实参考图的 GET/HEAD 必须 200 且有 `no-store`/`noindex`，POST 必须 403/405；视频终态后该精确文件必须删除。
- 人工目视与账务确认之前只运行 hard-maintenance 503；确认后才原子安装正式 vhost、启动 cleanup timer、执行全量生产验证。
- 任意失败会停止 API、把两个 feature flag 原子改回 false，并维持 hard-maintenance。重跑必须使用相同 `SMOKE_RUN_ID`。

## 7. 参考图与定时清理验收

正式 vhost 必须：

- 根域参考路径只允许 GET/HEAD，`autoindex off`，响应有 `Cache-Control: private, no-store`、`Pragma: no-cache`、`X-Robots-Tag: noindex`、严格 CSP、`nosniff`、`DENY`、`no-referrer`。
- 根域参考路径 POST 返回 403/405；不存在文件的 GET/HEAD 仍为 404 并带 no-store/noindex。
- API 子域同路径始终 404，不成为第二个匿名文件源。
- 普通 API 与视频 API gateway ceiling 为 26 MiB，足以覆盖后端合法的 24 MiB 编码参考数据与 JSON envelope。
- `/gallery/` 必须命中专用 `^~` location，响应为 `max-age=3600, must-revalidate` 且不含 `immutable`；同名素材发布时还必须使用新的 URL 版本标识以绕过历史一年期缓存。
- root timer 每天递归清理；路径必须精确解析为 `/var/www/neovista/backend/static/seedance_references`，任何其他目录直接拒绝。

最终验证：

```bash
sudo systemctl status neovista-api nginx neovista-seedance-reference-cleanup.timer --no-pager
pgrep -af 'uvicorn main:app'  # 只能一个
sudo env BASE_URL=https://neovista.cn API_BASE_URL=https://api.neovista.cn \
  EXPECTED_IMAGE_FEATURE=true EXPECTED_SEEDANCE_FEATURE=true \
  /var/www/neovista/deploy/scripts/verify-neovista-production.sh
```

## 8. 安全成对回滚

失败时只使用迁移脚本打印的精确 `RELEASE_BACKUP`。回滚脚本不会在线安装依赖，不会启动旧 API，也不会恢复可能暴露参考图/付费端点的旧公网 vhost；它只恢复旧代码、旧 venv 指针、旧 systemd unit 与配对 DB，然后启动 hard-maintenance 503：

```bash
export RELEASE_BACKUP='/var/backups/neovista/releases/填写失败发布目录'
sudo env NEOVISTA_ROLLBACK_CONFIRMED=YES RELEASE_BACKUP="$RELEASE_BACKUP" \
  /var/www/neovista/deploy/scripts/rollback-neovista-production.sh --execute
```

回滚成功必须满足：

- `IMAGE_GENERATION_FEATURE_ENABLED=false` 与 `SEEDANCE_FEATURE_ENABLED=false`。
- API 保持 stopped；根域、API、参考路径公网均为 hard-maintenance 503。
- 旧 DB integrity/foreign-key check 通过，旧 artifact SHA 清单通过，venv 指向发布前目标。

旧 API 只能在新的维护审批中本机启动诊断。确认其付费端点、静态参考路径和 readiness 兼容前，不得切回公网。

## 9. 上线后 24 小时观察

- 每分钟检查 `/api/ready`，任何非 200 或任一 check=false 立即告警。
- 观察 `NRestarts`、SQLite busy/locked、上游超时、hold/refund/capture 数量。
- 对比任务与账本，不得出现 orphan hold、重复 settlement 或同用户多个 unresolved task。
- 1、6、24 小时运行一次 cleanup dry-run，确认 `eligible=0`。
- 只记录聚合计数和内部 ID；不记录 prompt、参考图 URL、JWT、邮箱、API key 或生成结果 URL。
