# Google Apps Script + Google Sheets

เวอร์ชันนี้รันบน Google ทั้งหมด:

- หน้าเว็บลูกค้าและหลังบ้านเสิร์ฟจาก Google Apps Script
- ข้อมูลคิวเก็บใน Google Sheets (ชีต `Bookings`)

## URL

- หน้าลูกค้า: https://script.google.com/macros/s/AKfycbzmeR0Ue6SvIc1twZmWIsdTHUE_fTe42yrYNYCTR5Jy_bePwCx9R89VuWGhI03TiGXe/exec?page=home
- หลังบ้าน: https://script.google.com/macros/s/AKfycbzmeR0Ue6SvIc1twZmWIsdTHUE_fTe42yrYNYCTR5Jy_bePwCx9R89VuWGhI03TiGXe/exec?page=admin
- Google Sheets: https://docs.google.com/spreadsheets/d/1wRftatxh8HMBnOZkXAWq9UkoJt-oFofaj7O-e5QzU5A/edit

## ฝังใน Google Sites

1. เปิด Google Sites แล้วสร้างไซต์ใหม่
2. เพิ่มหน้า → Insert → Embed → Embed code
3. วาง iframe ด้านล่าง (หน้าลูกค้า)
4. ทำหน้าใหม่สำหรับหลังบ้านโดยใช้ URL `?page=admin`
5. Publish

```html
<iframe
  src="https://script.google.com/macros/s/AKfycbzmeR0Ue6SvIc1twZmWIsdTHUE_fTe42yrYNYCTR5Jy_bePwCx9R89VuWGhI03TiGXe/exec?page=home"
  style="width:100%;height:900px;border:0"
  loading="lazy"></iframe>
```

> Google Sites ไม่มี API สำหรับสร้างหน้า/ฝัง iframe อัตโนมัติ จึงต้องวาง embed ผ่านหน้าเว็บ Sites

## Deploy

```bash
npx @google/clasp push
npx @google/clasp deploy
```

ไฟล์ `.clasp.json` ถูก ignore เพราะเก็บ script ID ของโปรเจกต์

## หมายเหตุ

- Google Apps Script แสดงแบนเนอร์ “แอปพลิเคชันนี้สร้างโดยผู้ใช้ Google Apps Script” ด้านบนเสมอ
- ระบบซิงก์ด้วย polling ทุก 5 วินาที (Google Apps Script ไม่มี SSE)
- การแจ้งเตือนผ่าน Browser Notification อาจถูกจำกัดเมื่ออยู่ใน iframe ของ Google Sites; การแจ้งเตือนในหน้าเว็บยังทำงาน
- หลังบ้านไม่มี PIN; เก็บ URL `/exec?page=admin` เป็นความลับ
