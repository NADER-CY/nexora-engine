# NEXORA ENGINE — راهنمای فارسی

> NEXORA ENGINE نسخهٔ مشتق (fork) از [REA — Reverse Engineer Anything](https://github.com/morluto/rea) نوشتهٔ morluto است و تحت مجوز MIT منتشر می‌شود. مجوز و اعتبار نویسندگان اصلی در `LICENSE`، `NOTICE.md` و `THIRD_PARTY_NOTICES.md` حفظ شده است.

**وضعیت:** نسخهٔ توسعه‌ای فاز ۱ (NEXORA 0.5.0). در npm یا هیچ رجیستری منتشر نشده است. جزئیات بررسی امنیتی و موارد اجرا‌نشده در `SECURITY_AUDIT.md` آمده است.

## تغییرات فاز ۱

| بخش | تغییر |
|---|---|
| CLI آفلاین `nexora` | خلاصهٔ جلسه، نگاشت بک‌اند، اسکن جریانی باندل، بررسی ایمنی ZIP، ممیزی اسکریپت‌های نصب |
| حافظه | خواندن JSONL به‌صورت تکه‌ای؛ خطِ بزرگ‌تر از حد، بدون بافر شدن رد می‌شود (نسخهٔ ۰٫۴ روی یک خط بزرگ کرش می‌کرد). باندل‌ها در تکه‌های ۱ مگابایتی اسکن می‌شوند |
| محدودیت‌ها | حجم فایل، طول خط، تعداد رکورد، حافظه، حجم خروجی، زمان، هم‌زمانی |
| لغو عملیات | مهلت زمانی برای هر فرمان و لغو تمیز با Ctrl+C |
| ویندوز | رفع خطای تشخیص نقطهٔ ورود؛ اسکریپت‌های ۰٫۴ در ویندوز هیچ کاری انجام نمی‌دادند |
| به‌روزرسانی امن | `rea update` غیرفعال است تا NEXORA ENGINE هرگز با بستهٔ اصلی `rea-agents` یا بستهٔ تأییدنشده جایگزین نشود |
| ثبت MCP | ثبت لانچر محلی با کلید `nexora-engine`؛ بدون `npx` از رجیستری عمومی |
| انتشار | گردش‌کارهای انتشار upstream غیرفعال شده‌اند و `package.json` در حالت `private` است |

## نصب از سورس

```powershell
npm ci --ignore-scripts
npm run build
```

## فرمان‌های آفلاین (بدون بیلد و بدون شبکه)

```powershell
node .\nexora\bin\nexora.mjs summary .\session.jsonl --out .\summary.json
node .\nexora\bin\nexora.mjs backend-map .\session.jsonl --out .\backend-map.json
node .\nexora\bin\nexora.mjs scan-bundle .\app.bundle.js --out .\bundle.json
node .\nexora\bin\nexora.mjs check-archive .\incoming.zip
node .\nexora\bin\nexora.mjs audit-lifecycle .
```

فرمان‌های نسخهٔ ۰٫۴ همچنان کار می‌کنند:

```powershell
node .\scripts\rea-session-report.mjs .\session.jsonl .\summary.json
node .\scripts\nexora-backend-map.mjs .\session.jsonl .\backend-map.json
```

## تست

```powershell
npm run test:nexora      # all NEXORA suites, plain Node (no tsx needed)
```

## نکات مهم

- خروجی «نگاشت بک‌اند» پیشنهاد معماری است، نه مشاهدهٔ مستقیم پیاده‌سازی سرور.
- دادهٔ خام حساب، کوکی، رمز، توکن، شناسهٔ سفارش و موجودی را هرگز وارد مخزن نکنید.
- پیش از انتشار عمومی، موارد «NOT EXECUTED» در `SECURITY_AUDIT.md` را روی سیستم خود اجرا کنید.
