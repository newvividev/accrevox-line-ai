# Accrevox LINE MVP

MVP นี้เป็น backend ตัวกลางระหว่าง `LINE Official Account` กับ `Accrevox Partner API` เพื่อให้ผู้ใช้สั่งออกเอกสารผ่านแชต และให้ระบบตอบกลับเป็นสถานะหรือลิงก์ไฟล์ PDF

## ขอบเขตของ MVP

- รองรับ `ใบเสนอราคา`, `ใบแจ้งหนี้` และ `ใบเสร็จรับเงิน`
- ใช้รูปแบบคำสั่งแบบกึ่งโครงสร้าง เพื่อลดความคลุมเครือ
- ค้นหา `contactId` และ `productId` จากชื่อก่อนยิง API
- สร้างเอกสารผ่าน `POST /api/v1/quotations`, `POST /api/v1/invoices`, และ `POST /api/v1/receipts`
- poll `GET /api/v1/documents/jobs/{trackingId}` จน job เสร็จ
- ตอบกลับใน LINE ด้วยเลขเอกสาร สถานะ และลิงก์ PDF เมื่อมีข้อมูลพร้อม
- รองรับแนวทางธุรกิจแบบ `แพ็กเกจหลัก + AI Add-on + เครดิต`
- วางโครงสร้าง `multi-tenant` ตั้งแต่ต้น

## โมเดลธุรกิจที่ใช้

- `แพ็กเกจหลัก` คือความสามารถพื้นฐาน เช่น webhook, orchestration, ออกเอกสารผ่าน Accrevox API
- `AI Add-on` เป็นสิทธิ์เปิดใช้งานความสามารถตีความภาษาธรรมชาติ
- `เครดิต` ใช้สำหรับหัก usage เมื่อมีการเรียก AI จริง

แนวคิดสำคัญ:

- ถ้าข้อความ parse ได้ด้วย rule-based parser จะไม่หักเครดิต
- จะหักเครดิตเฉพาะตอนเรียก AI จริง
- ถ้า tenant ไม่มี AI add-on หรือเครดิตไม่พอ ระบบยังทำงานต่อได้ในโหมดคำสั่งแบบตายตัว

## สิ่งที่สเปกปัจจุบันรองรับ

จาก Partner API Spec v1.1:

- token: `POST /api/v1/token`
- contacts: `GET /api/v1/contacts`
- products: `GET /api/v1/products`
- quotations: `POST /api/v1/quotations`
- invoices: `POST /api/v1/invoices`
- receipts: `POST /api/v1/receipts`
- async job status: `GET /api/v1/documents/jobs/{trackingId}`

หมายเหตุ:

- สเปกนี้ยังไม่เห็น endpoint สำหรับ `ใบสำคัญจ่าย`
- ในเอกสารมีคำอธิบายว่า job result ของ document ควรมี `pdfUrl` แต่ตัวอย่าง response แสดงเพียง `id` จึงควรทดสอบกับระบบจริงอีกครั้ง

## รูปแบบคำสั่งที่แนะนำสำหรับ MVP

ให้ผู้ใช้พิมพ์แบบนี้ก่อน:

```text
ออกใบเสนอราคา ลูกค้า=บริษัท ABC วันที่=2026-05-03 รายการ=ปากกา,10,20;สมุด,5,50
ออกใบแจ้งหนี้ ลูกค้า=บริษัท ABC วันที่=2026-05-03 ครบกำหนด=2026-05-10 รายการ=ปากกา,10,20
ออกใบเสร็จ ลูกค้า=บริษัท ABC วันที่=2026-05-03 ครบกำหนด=2026-05-03 รายการ=ปากกา,10,20
```

กติกา:

- `ลูกค้า=` ใช้ชื่อสำหรับค้นหา contact
- `วันที่=` ใช้รูปแบบ `YYYY-MM-DD`
- `ครบกำหนด=` ใช้รูปแบบ `YYYY-MM-DD` สำหรับ `ใบแจ้งหนี้` และ `ใบเสร็จรับเงิน`
- `รายการ=` แยกหลายรายการด้วย `;`
- แต่ละรายการใช้รูปแบบ `ชื่อสินค้า,จำนวน,ราคาต่อหน่วย`

## ลำดับการทำงาน

1. LINE ส่ง webhook event เข้ามาที่ backend
2. backend parse ข้อความเป็น intent และข้อมูลเอกสาร
3. backend ค้นหา contact และ product ใน Accrevox
4. backend สร้างเอกสารตามชนิดที่สั่ง
5. backend poll job status
6. backend ส่งข้อความกลับ LINE

## โครงสร้างไฟล์

```text
prisma/
  schema.prisma
src/
  app.ts
  config.ts
  db.ts
  index.ts
  repositories/
    creditWalletPrismaRepository.ts
    tenantPrismaRepository.ts
  routes/
    adminRouter.ts
    lineWebhook.ts
  services/
    accrevoxClient.ts
    aiAccessPolicy.ts
    creditLedger.ts
    documentOrchestrator.ts
    intentParser.ts
  types/
    tenant.ts
```

## วิธีรัน

```bash
npm install
npx prisma generate
npm run dev
```

## วิธีรันด้วย Docker

```bash
docker compose up --build
```

ถ้ารันครั้งแรก ให้เปิดอีก terminal แล้วสั่ง:

```bash
docker compose exec app npx prisma migrate dev --name init
docker compose exec app npm run prisma:seed
```

หลังจากนั้น app จะพร้อมที่:

- `http://localhost:3000/health`

PostgreSQL จะพร้อมที่:

- host: `localhost`
- port: `5432`
- database: `accrevox_line_mvp`
- username: `postgres`
- password: `postgres`

ข้อมูลเริ่มต้นที่ seed ให้:

- tenant code: `demo`
- package plan: `core`
- AI add-on: `enabled`
- AI mode: `credit`
- เครดิตเริ่มต้น: `1000`

## Webhook ที่ต้องตั้งใน LINE

- URL: `POST /webhooks/line/:tenantId`

ตัวอย่าง:

- `https://your-domain.com/webhooks/line/demo`

แนวทางนี้เหมาะกับตอนเริ่มต้น เพราะแยก tenant ได้ชัดเจนโดยไม่ต้องพึ่ง database ก่อน ใน production ค่อยขยับไป map tenant จาก channel หรือ database ได้

## Admin API เบื้องต้น

ตอนนี้มี endpoint สำหรับเดโมและจัดการเครดิตเบื้องต้นแล้ว:

```text
GET  /admin/tenants/:tenantCode
GET  /admin/tenants/:tenantCode/wallet
POST /admin/tenants/:tenantCode/wallet/topup
GET  /admin/tenants/:tenantCode/wallet/transactions?limit=20
GET  /admin/tenants/:tenantCode/line-connections?limit=50
GET  /admin/tenants/:tenantCode/document-requests?limit=20
```

ตัวอย่าง top-up:

```bash
curl -X POST http://localhost:3000/admin/tenants/demo/wallet/topup \
  -H "Content-Type: application/json" \
  -d "{\"amount\":500,\"reason\":\"Initial sales demo credit\"}"
```

หมายเหตุ:

- รอบนี้ยังไม่มี auth/admin permission
- เหมาะสำหรับ local development และเดโมเท่านั้น
- ก่อนขึ้น production ควรเพิ่ม authentication, audit actor และ rate limit

ระหว่างพัฒนาในเครื่อง แนะนำเปิดผ่าน tunnel เช่น ngrok หรือ Cloudflare Tunnel แล้วนำ URL ไปใส่ใน LINE Developers Console

## สิ่งที่ควรทำต่อทันที

1. ต่อ OpenAI หรือ parser ที่ต้องการเข้ากับ `intentParser.ts` โดยเรียกผ่านชั้น `aiAccessPolicy.ts`
2. เพิ่ม database หรือ Redis สำหรับเก็บ tenant, session, credit ledger และ usage log
3. เพิ่ม allowlist ผู้ใช้ LINE ที่มีสิทธิ์ออกเอกสาร
4. เพิ่ม fallback flow เมื่อค้นหาลูกค้าหรือสินค้าเจอหลายรายการ
5. ยืนยัน field สำหรับดาวน์โหลด PDF จาก job result กับระบบ Accrevox จริง
6. กำหนดราคาเครดิต เช่น 1 คำสั่ง AI = 1 เครดิต หรือคิดตามระดับความซับซ้อน

## สิ่งที่ schema รอบนี้ครอบคลุม

- `Tenant` สำหรับแยกบริษัท
- `LineChannel` สำหรับผูก LINE OA ต่อ tenant
- `AccrevoxConnection` สำหรับเก็บ credentials ต่อ tenant
- `AiSubscription` สำหรับแพ็กเกจ AI add-on และโหมดการใช้งาน
- `CreditWallet` และ `CreditTransaction` สำหรับเครดิตคงเหลือและ ledger
- `ChatSession` สำหรับรองรับการคุยต่อเนื่อง
- `DocumentRequest` และ `DocumentJob` สำหรับ audit และติดตามงานเอกสาร

## Audit Flow ของคำสั่ง LINE

เมื่อมีข้อความสั่งงานเข้ามาจาก LINE ระบบจะ:

1. สร้าง `DocumentRequest` สถานะ `received`
2. parse ข้อความและอัปเดตเป็น `validating`
3. เมื่อส่งเข้า Accrevox สำเร็จ จะอัปเดตเป็น `submitted` และสร้าง `DocumentJob` พร้อม `trackingId`
4. เมื่อ job สำเร็จ จะอัปเดต `DocumentRequest` เป็น `completed`
5. ถ้าพบข้อผิดพลาดระหว่าง parse หรือ job fail จะอัปเดตเป็น `failed`

แนวทางนี้ช่วยให้ตามย้อนหลังได้ว่า:

- ใครส่งข้อความอะไรเข้ามา
- ระบบ parse ได้หรือไม่
- ส่งเข้า Accrevox แล้วหรือยัง
- job ไหนล้มเหลว
- ได้เลขเอกสารและ PDF กลับมาหรือไม่

## Flow เชื่อมต่อ Accrevox ผ่าน LINE

ตอนนี้รองรับ flow เริ่มต้นแบบนี้แล้ว:

1. ผู้ใช้พิมพ์ `เชื่อมต่อ Accrevox`
2. บอทตอบกลับให้ส่ง `Company API Key`
3. ผู้ใช้ส่ง key
4. ระบบเรียก `GET /api/v1/companies` เพื่อตรวจสอบ key
5. ถ้าสำเร็จ ระบบจะผูก LINE user กับ tenant/company และอัปเดต `companyApiKey` ของ tenant

หมายเหตุ:

- พิมพ์ `ยกเลิก` ได้ระหว่างที่ระบบกำลังรอ API key
- รอบนี้เป็น MVP จึงยังเก็บ key ใน `AccrevoxConnection` โดยตรง
- ก่อน production ควรเพิ่มการเข้ารหัส secret และสิทธิ์การเข้าถึงฝั่ง admin

## คำสั่งช่วยใน LINE

ตอนนี้รองรับคำสั่งช่วยค้นหาข้อมูลจาก Accrevox แล้ว:

```text
ดูลูกค้า
ดูลูกค้า บริษัท
ดูสินค้า
ดูสินค้า ปากกา
มีลูกค้าอะไรบ้าง
มีสินค้าอะไรบ้าง
item มีอะไรบ้าง
ดูบริษัท
ดูสถานะการเชื่อมต่อ
ดูคำขอล่าสุด
เมนู
คุณทำอะไรได้บ้าง
```

คำสั่งเหล่านี้จะดึงข้อมูลจริงจาก Accrevox แล้วสรุปผลกลับในแชต เพื่อช่วยให้ผู้ใช้ใช้ชื่อลูกค้าและสินค้าที่ถูกต้องตอนสั่งออกเอกสาร

## Repository Layer ที่มีในรอบนี้

- Prisma-backed tenant repository สำหรับโหลด config ต่อ tenant จากฐานข้อมูล
- Prisma-backed credit wallet repository สำหรับดูยอดเครดิตและตัดเครดิต

แนวทางนี้ช่วยให้รอบถัดไปต่อ admin API หรือ billing dashboard ได้ง่าย โดยไม่ต้องรื้อ service เดิม

## เรื่องใบสำคัญจ่าย

ถ้าจะรองรับ `ใบสำคัญจ่าย` ผ่าน flow เดียวกัน มี 2 ทาง:

1. เพิ่ม endpoint ใน Partner API ให้สร้างเอกสารชนิดนี้ได้โดยตรง
2. ทำ workflow ชั่วคราวให้บอทเก็บข้อมูลและส่งต่อให้เจ้าหน้าที่หรือระบบภายในสร้างเอกสารแทน
