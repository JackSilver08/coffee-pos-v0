# Coffee POS v1.0

Modern desktop POS cho quán cà phê theo hướng local-first / offline-ready.

## Stack

- Electron 44
- Node.js 24 LTS
- Express 5
- PostgreSQL 18
- Bootstrap 5
- Docker Compose
- pg
- crypto.scrypt cho password hashing

## Role chính

| Chức năng | cashier | barista | admin |
|---|:---:|:---:|:---:|
| Đăng nhập | ✅ | ✅ | ✅ |
| Bán hàng | ✅ | ❌ | ✅ |
| Cash / QR demo | ✅ | ❌ | ✅ |
| Mở / đóng ca | ✅ | ❌ | ✅ |
| Xem đơn | ✅ | ❌ | ✅ |
| KDS | ❌ | ✅ | ✅ |
| Báo cáo | ❌ | ❌ | ✅ |
| Quản lý sản phẩm | ❌ | ❌ | ✅ |
| Quản lý danh mục | ❌ | ❌ | ✅ |
| Quản lý user | ❌ | ❌ | ✅ |

RBAC được enforce ở Express API. UI chỉ là lớp hiển thị.

## Kiến trúc

    Electron Renderer
          |
          | HTTP
          v
    Node.js + Express
          |
          v
    PostgreSQL 18

    Electron Main -- IPC --> Print dialog

## Cài đặt

Yêu cầu Windows 10/11:

1. Node.js 24.x
2. Docker Desktop
3. Git
4. VS Code hoặc IDE tương đương

Kiểm tra:

    node -v
    npm -v
    docker --version
    git --version

Clone repo:

    git clone https://github.com/JackSilver08/coffee-pos-v0.git
    cd coffee-pos-v0
    git checkout v1

Tạo .env:

    Copy-Item .env.example .env

Nội dung:

    NODE_ENV=development
    PORT=4782
    DATABASE_URL=postgresql://pos:pos@127.0.0.1:5433/coffee_pos

Port 5433 được dùng vì máy development có PostgreSQL native đang chiếm 5432.

Cài dependency:

    npm install

## PostgreSQL

    docker compose up -d
    docker compose ps

Phải thấy:

    0.0.0.0:5433 -> 5432/tcp

## Database setup

    npm run db:setup

Migration RBAC:

    db/migrations/003_v1_rbac.sql

## Tài khoản demo

    admin   / admin123
    cashier / cashier123
    barista / barista123

Đây chỉ là credential development. Phải đổi trước production.

## Chạy

    npm run dev

API health:

    http://127.0.0.1:4782/api/health

Setup + chạy trong một lệnh:

    npm run dev:setup

## Vai trò

### Cashier

Được phép bán hàng, thanh toán Cash hoặc QR demo, mở/đóng ca và xem đơn.

### Barista

Chỉ dùng KDS:

    NEW -> PREPARING -> READY -> DONE

Barista không có quyền tạo order hoặc payment.

### Admin

Có toàn bộ chức năng v1, cộng quản lý sản phẩm, danh mục, báo cáo, user và KDS.

## API chính

Authentication:

    POST /api/auth/login
    POST /api/auth/logout
    GET  /api/auth/me

Catalog:

    GET   /api/products
    GET   /api/categories
    POST  /api/products
    PATCH /api/products/:id
    POST  /api/categories

Shift:

    GET  /api/shifts/current
    POST /api/shifts/open
    POST /api/shifts/:id/close

Order:

    POST /api/orders
    GET  /api/orders/today

KDS:

    GET   /api/kds/orders
    PATCH /api/kds/orders/:id/status

Reports:

    GET /api/reports/today

Users:

    GET   /api/users
    POST  /api/users
    PATCH /api/users/:id/status

## Security

Electron renderer:

    contextIsolation = true
    nodeIntegration = false

Authentication sử dụng password hash bằng crypto.scrypt và session token random. Database chỉ lưu SHA-256 của session token. RBAC được kiểm tra server-side.

## Scripts

    npm run dev
    npm run dev:setup
    npm run server
    npm run db:migrate
    npm run db:seed
    npm run db:setup
    npm run lint
    npm test
    npm run pack
    npm run dist

## Backup dev

    docker compose exec postgres pg_dump -U pos -d coffee_pos > coffee-pos-backup.sql

Reset database dev:

    docker compose down -v
    docker compose up -d
    npm run db:setup

Không dùng down -v cho production.

## Roadmap

    v1.0  RBAC + POS + Shift + KDS + Catalog + Reports
    v1.1  Variant + Topping + Combo + Note
    v1.2  Inventory + Recipe + Cost
    v1.3  Refund + Void + Discount approval
    v1.4  E-invoice adapter
    v1.5  QR webhook / payment confirmation
    v2.0  LAN multi-terminal + sync engine
    v2.1  Cloud dashboard
    v2.2  Loyalty
    v3.0  Multi-branch
