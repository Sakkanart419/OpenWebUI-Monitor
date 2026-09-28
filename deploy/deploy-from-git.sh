#!/usr/bin/env bash
# ============================================================
# OpenWebUI-Monitor deploy-from-git
# ใช้ deploy เครื่องใหม่ / อัปเดตเครื่องเก่าจาก git แทนการ patch ในที่
#
# Usage:
#   ./deploy-from-git.sh              # clone/pull + build + up -d (REF=v0.3.9)
#   REF=main ./deploy-from-git.sh     # เอา branch หลัก
#   DIR=/opt/OpenWebUI-Monitor ./deploy-from-git.sh
#
# ต้องการ: git, docker (compose plugin), ไฟล์ .env (copy จากเครื่องอื่น หรือสร้างใหม่
#          ตาม .env.example — .env ไม่อยู่ใน git โดยเจตนา: มี secrets/DB password)
# ============================================================
set -euo pipefail

REPO="${REPO:-https://github.com/Sakkanart419/OpenWebUI-Monitor.git}"
REF="${REF:-v0.3.9}"
DIR="${DIR:-OpenWebUI-Monitor}"
PORT="${PORT:-7878}"

cd "$(dirname "$0")/.." 2>/dev/null || true   # ถ้า script อยู่ใน repo แล้ว ให้รันจาก repo root ได้
# NOTE: ถ้ารันครั้งแรก (ยังไม่มี repo) ตัว script จะ clone ไปที่ $DIR ใน working dir ปัจจุบัน

# ---------- 1. clone หรือ pull ----------
if [ -d "$DIR/.git" ]; then
  echo "==> Updating existing clone at $DIR"
  git -C "$DIR" fetch --all --tags --prune
  git -C "$DIR" checkout "$REF"
  git -C "$DIR" reset --hard "origin/$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || echo "$REF")" 2>/dev/null || git -C "$DIR" checkout "$REF"
else
  echo "==> Cloning $REPO ($REF) into $DIR"
  git clone "$REPO" "$DIR"
  git -C "$DIR" checkout "$REF"
fi

# ---------- 2. .env ต้องมี ----------
if [ ! -f "$DIR/.env" ]; then
  echo "!! $DIR/.env ไม่พบ — คัดลอกจากเครื่องเดิมหรือจาก .env.example แล้วแก้ค่าก่อน:"
  echo "   POSTGRES_HOST/PORT/USER/PASSWORD/DATABASE, OPENWEBUI_URL, ราคา default ฯลฯ"
  exit 1
fi

# ---------- 3. build (nohup-safe: รันผ่าน ssh ได้ ไม่ตายเมื่อหลุด) ----------
echo "==> docker compose build (log: $DIR/build.log)"
cd "$DIR"
docker compose build app 2>&1 | tee build.log | tail -3

# ---------- 4. up ----------
echo "==> docker compose up -d"
docker compose up -d

# ---------- 5. verify ----------
echo "==> Waiting for app on :$PORT ..."
for i in $(seq 1 24); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" || true)
  [ "$code" = "200" ] && break
  sleep 5
done
echo "HTTP $code"
VER=$(docker compose exec -T app grep -o '"version": *"[^"]*"' package.json || echo "?")
echo "Deployed $VER @ $(git -C "$DIR" rev-parse --short HEAD) (ref $REF)"
[ "$code" = "200" ] && echo "DEPLOY_OK" || { echo "DEPLOY_FAILED: app not responding"; exit 1; }
