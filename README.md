# Coffee POS v0.1

POS desktop prototype cho quán cà phê, xây theo hướng **local-first** với:

- Electron 44
- Node.js 24 LTS
- Express 5
- PostgreSQL 18
- Bootstrap 5
- Electron IPC an toàn qua `contextBridge`
- Docker Compose cho PostgreSQL

## 1. v0 hiện có gì?

### Bán hàng

- Danh mục sản phẩm.
- Tìm kiếm sản phẩm.
- Thêm/xóa/tăng/giảm số lượng trong giỏ.
- Tính tiền tự động.
- Thanh toán tiền mặt.
- Thanh toán QR ở mức demo, chưa kết nối ngân hàng/webhook.
- Tự tính tiền thừa.
- Lưu Order + Payment trong một transaction PostgreSQL.
- In hóa đơn bằng dialog print của Electron.

### Vận hành

- Mở ca.
- Đóng ca.
- Gắn order vào ca đang mở.
- Audit log cho giao dịch tạo order.

### Báo cáo

- Số đơn hôm nay.
- Doanh thu hôm nay.
- Top sản phẩm.
- Danh sách đơn gần đây.

### Kiến trúc

```text
Electron Renderer
       │
       │ HTTP localhost
       ▼
Node.js + Express
       │
       ▼
PostgreSQL 18
       │
       └── orders / payments / shifts / audit_logs

Electron Main ── IPC ──> Printer dialog
```

## 2. Yêu cầu môi trường

Khuyến nghị trên Windows 10/11:

1. **Node.js 24 LTS**
2. **Docker Desktop**
3. Git
4. Visual Studio Code hoặc IDE tương đương

Kiểm tra:

```powershell
node -v
npm -v
docker --version
git --version
```

Node nên là nhánh 24.x.

## 3. Cài đặt project

Clone project:

```powershell
git clone <YOUR_REPOSITORY_URL>
cd coffee-pos-v0
```

Tạo file môi trường:

```powershell
Copy-Item .env.example .env
```

File `.env` mặc định:

```env
NODE_ENV=development
PORT=4782
DATABASE_URL=postgresql://pos:pos@localhost:5432/coffee_pos
```

Cài package:

```powershell
npm install
```

## 4. Khởi động PostgreSQL

```powershell
docker compose up -d
```

Kiểm tra container:

```powershell
docker compose ps
```

Phải thấy service `postgres` đang `running`/`healthy`.

Xem log khi cần:

```powershell
docker compose logs -f postgres
```

## 5. Tạo database schema + dữ liệu mẫu

Chạy:

```powershell
npm run db:setup
```

Lệnh này tương đương:

```powershell
npm run db:migrate
npm run db:seed
```

Migration nằm ở:

```text
db/migrations/
```

Seed sản phẩm mẫu nằm ở:

```text
scripts/seed.js
```

## 6. Chạy POS

Sau khi PostgreSQL đã chạy:

```powershell
npm run dev
```

`npm run dev` sẽ:

1. Chạy migration.
2. Seed dữ liệu mẫu.
3. Mở Electron.
4. Spawn local Express API ở `127.0.0.1:4782`.
5. Mở giao diện POS.

API health:

```text
http://127.0.0.1:4782/api/health
```

Bạn cũng có thể chạy API riêng để debug:

```powershell
npm run server
```

## 7. Luồng test v0

Sau khi app mở:

```text
1. Bấm "Mở ca"
2. Nhập tên thu ngân + tiền đầu ca
3. Chọn món
4. Điều chỉnh số lượng
5. Chọn "Tiền mặt"
6. Nhập số tiền khách đưa
7. Bấm "Thanh toán"
8. POS lưu Order + Payment
9. Electron mở print dialog
10. Vào "Báo cáo" để xem doanh thu
```

Ví dụ:

```text
Latte              45,000
Americano x2       70,000
--------------------------
Tổng              115,000
Khách đưa          200,000
Tiền thừa           85,000
```

## 8. Các script quan trọng

```powershell
npm run dev        # migrate + seed + mở Electron
npm run server     # chạy API riêng
npm run db:migrate # chạy migration
npm run db:seed    # seed dữ liệu
npm run db:setup   # migrate + seed
npm run lint       # kiểm tra syntax Node
npm test           # test runner hiện tại
npm run pack       # build thư mục app
npm run dist       # build installer Windows
```

## 9. Tắt database

```powershell
docker compose down
```

Dữ liệu vẫn giữ lại nhờ Docker volume.

Muốn xóa toàn bộ dữ liệu dev:

```powershell
docker compose down -v
```

> Cẩn thận: `-v` xóa volume PostgreSQL.

## 10. Cấu trúc project

```text
coffee-pos-v0/
├─ src/
│  ├─ main/
│  │  └─ main.js
│  ├─ preload/
│  │  └─ preload.js
│  ├─ renderer/
│  │  ├─ index.html
│  │  ├─ styles.css
│  │  └─ app.js
│  └─ server/
│     ├─ app.js
│     ├─ db.js
│     └─ index.js
│
├─ db/
│  └─ migrations/
│     ├─ 001_init.sql
│     └─ 002_seed_ready.sql
│
├─ scripts/
│  ├─ migrate.js
│  └─ seed.js
│
├─ docker-compose.yml
├─ .env.example
├─ package.json
└─ README.md
```

## 11. Database model v0

```text
categories
    │
    └── products
            │
            ▼
          orders
         /      \
        ▼        ▼
 order_items   payments
        │
        │
        └────────────┐
                     ▼
                   shifts

orders ─────────────► audit_logs
```

Các nguyên tắc đã áp dụng:

- Order item lưu **snapshot tên + giá**.
- Payment tách khỏi Order.
- Order và Payment được tạo bằng transaction.
- Order không bị xóa vật lý trong flow bán hàng.
- Shift có trạng thái `OPEN/CLOSED`.
- Audit log ghi actor/action/entity/payload.

## 12. API v0

### Health

```http
GET /api/health
```

### Products

```http
GET /api/products
GET /api/categories
```

### Shift

```http
GET  /api/shifts/current
POST /api/shifts/open
POST /api/shifts/:id/close
```

### Order

```http
POST /api/orders
GET  /api/orders/today
```

Ví dụ request:

```json
{
  "shiftId": "UUID",
  "paymentMethod": "CASH",
  "receivedAmount": 200000,
  "items": [
    {
      "productId": "UUID",
      "quantity": 2
    }
  ]
}
```

### Report

```http
GET /api/reports/today
```

## 13. Build installer Windows

Sau khi test xong:

```powershell
npm run dist
```

Installer sẽ nằm trong:

```text
release/
```

Đây mới là build thử nghiệm. Trước khi đưa cho quán thật cần bổ sung signing, migration strategy khi upgrade, crash recovery và auto-update policy.

## 14. Kiến trúc bảo mật v0

Renderer không được truy cập Node.js trực tiếp.

`BrowserWindow` dùng:

```text
contextIsolation = true
nodeIntegration = false
```

Renderer chỉ nhận API POS được expose có chọn lọc từ `preload.js`:

```js
window.pos.getVersion()
window.pos.printReceipt(receipt)
```

Local API bind vào:

```text
127.0.0.1
```

Không bind `0.0.0.0` ở v0.

## 15. Cách mở rộng lên POS nhiều máy

v0 hiện tại:

```text
Electron
   │
   └── local Node API
             │
             └── PostgreSQL
```

Kiến trúc target:

```text
POS 1 ──┐
POS 2 ──┼── LAN ──> Local POS Server ──> PostgreSQL
KDS  ───┤
Tablet ─┘
                 │
                 └── optional cloud sync
```

Khi làm multi-terminal:

- Server phải bind LAN interface.
- Thêm authentication/RBAC.
- Thêm terminal registry.
- Thêm idempotency key.
- Thêm device service cho printer/cash drawer.
- Thêm sync/outbox nếu cần cloud.

## 16. Những gì cố ý chưa có trong v0

```text
❌ Inventory ledger + recipe
❌ Topping/variant engine
❌ Loyalty
❌ Voucher/promotion engine
❌ Multi-branch
❌ Cloud sync
❌ Auto-confirm bank payment
❌ E-invoice provider
❌ KDS realtime
❌ Employee RBAC đầy đủ
❌ Refund workflow hoàn chỉnh
❌ Offline replication queue
```

Các module này nên được xây sau khi transaction flow `Order → Payment → Shift → Report` ổn định.

## 17. Troubleshooting

### `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL chưa chạy.

```powershell
docker compose up -d
```

### `password authentication failed`

Kiểm tra `.env` có đúng:

```env
DATABASE_URL=postgresql://pos:pos@localhost:5432/coffee_pos
```

Nếu môi trường dev đã bị lệch credential, xóa volume rồi dựng lại:

```powershell
docker compose down -v
docker compose up -d
npm run db:setup
```

### App mở nhưng hiện `API offline`

Kiểm tra:

```powershell
curl http://127.0.0.1:4782/api/health
```

Nếu API chạy riêng:

```powershell
npm run server
```

### Port 4782 bị chiếm

Đổi trong `.env`:

```env
PORT=4783
```

Sau đó phải đồng bộ `API` trong `src/renderer/app.js` thành:

```js
const API = 'http://127.0.0.1:4783/api';
```

## 18. Hướng phát triển v0.2

Ưu tiên kế tiếp:

```text
1. Product variant + topping
2. Inventory ledger
3. Recipe/ingredient
4. Refund / void / discount
5. RBAC + manager PIN
6. KDS realtime
7. ESC/POS printer adapter
8. QR payment webhook
9. E-invoice adapter
10. LAN multi-terminal
```

