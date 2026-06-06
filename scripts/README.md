# 📊 تقرير نهاية اليوم — IslamLifeV2

سكريبت Node بيشتغل كل يوم 10:00 مساءً بتوقيت القاهرة (cron على GitHub Actions)، يقرأ بياناتك من Firestore ويبعت تقرير على **تليجرام** و**جيميل** فيه:

- ✅ المهام اللي اتقفلت النهارده
- ⏱ ساعات البومودورو موزعة على المشاريع
- 📅 مهام بكرة من التقويم
- ⚠️ المهام المتأخرة

---

## 🚀 خطوات التشغيل (مرة واحدة بس)

### 1️⃣ إنشاء بوت تليجرام والحصول على `chat_id`

1. افتح [@BotFather](https://t.me/BotFather) في تليجرام، اعمل `/newbot` واتبع التعليمات.
2. هياديك **bot token** (شكله: `123456789:ABC-DEF...`). احفظه.
3. ابدأ محادثة مع البوت بتاعك واكتب أي رسالة (مثلاً `/start`).
4. للحصول على `chat_id` افتح في المتصفح:

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

   هتلاقي `"chat":{"id": 123456789, ...}` — ده رقمك.

### 2️⃣ تفعيل Gmail App Password

1. لازم يكون عندك **2-Step Verification** مفعّل على حسابك.
2. روح [Google Account → Security → App Passwords](https://myaccount.google.com/apppasswords).
3. اعمل كلمة سر للتطبيق (مثلاً "IslamLifeV2 Report") — هتاخد **16 حرف**.
4. احفظ الـ 16 حرف دول، مش هتشوفهم تاني.

### 3️⃣ إنشاء Firebase Service Account

1. روح [Firebase Console → Project Settings → Service Accounts](https://console.firebase.google.com/project/islam-life-e126e/settings/serviceaccounts/adminsdk).
2. اضغط **Generate new private key** — هينزل ملف JSON.
3. افتح الملف، انسخ محتواه كامل.

> ⚠️ **مهم:** الملف ده يدي قراءة/كتابة كاملة على Firestore. متشاركهوش ومتعملش commit له في الريبو نهائياً.

### 4️⃣ ضبط GitHub Secrets

روح `https://github.com/<USERNAME>/<REPO>/settings/secrets/actions` وضيف:

| اسم السيكرت | القيمة |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | محتوى ملف الـ JSON من خطوة 3 |
| `TELEGRAM_BOT_TOKEN` | التوكن من BotFather |
| `TELEGRAM_CHAT_ID` | الـ chat id من خطوة 1 |
| `GMAIL_USER` | إيميل الجيميل (اللي هيبعت منه) |
| `GMAIL_APP_PASSWORD` | الـ 16 حرف من خطوة 2 |
| `GMAIL_TO` | (اختياري) إيميل المستقبل، الافتراضي نفس `GMAIL_USER` |

### 5️⃣ نشر تحديث قواعد Firestore

التقرير محتاج كولكشن جديد اسمه `focusSessions` (السكريبت يقرأ منه ساعات البومودورو اليومية). الكولكشن ده اتضاف ل `firestore.rules`، انشره:

```bash
firebase deploy --only firestore:rules
```

### 6️⃣ تجربة فورية (Optional)

من تبويب **Actions** في GitHub، اختار workflow **Daily Report** واضغط **Run workflow**. لو فيه أي خطأ هيظهر في الـ logs.

---

## 🧠 ملاحظات تقنية

- **التوقيت:** الجدولة `0 20 * * *` UTC = 10:00 مساءً بتوقيت القاهرة (UTC+2). لو غيّرت `REPORT_TIMEZONE` لازم تعدل الـ cron نفسه برضو.
- **detection لـ "مهام النهارده":** السكريبت بيعتمد على حقل `completedAt` اللي بيتحط أوتوماتيك لما حالة المهمة تتغير لـ `done` (سواء من checkbox الداشبورد أو الـ kanban drag). المهام القديمة اللي اتقفلت قبل التحديث ده مش هتظهر — طبيعي.
- **ساعات البومودورو:** قبل التحديث كانت بتتسجل في `localStorage` بس. دلوقتي كل جلسة كاملة بتتبعت كمان لـ `focusSessions` في Firestore، والسكريبت بيلم اللي يوم تاريخه = اليوم.
- **فشل قناة واحدة:** لو تليجرام شغّال وجيميل فشل (أو العكس)، السكريبت بيكمل ويبعت اللي ينفع، وبيرجع exit code 1 عشان GitHub يبعت تنبيه فشل.

---

## 🔧 تشغيل محلي (للتطوير)

```bash
cd scripts
npm install

# ضع المتغيرات في .env أو export يدوي (PowerShell):
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content ./serviceAccount.json -Raw
$env:TELEGRAM_BOT_TOKEN = '...'
$env:TELEGRAM_CHAT_ID = '...'
$env:GMAIL_USER = '...'
$env:GMAIL_APP_PASSWORD = '...'

node daily-report.js
```

⚠️ متحطش ملف الـ service account ولا أي توكنز في الريبو. ضيف `serviceAccount.json` و `.env` في `.gitignore` لو هتجرب محلي.
