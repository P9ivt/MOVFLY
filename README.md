# MOFLVFLY

منصة بث أفلام ومسلسلات متكاملة بواجهة داكنة متدرجة (`#9303C5` / `#02060E`)، شريط تنقل عائم زجاجي (`Glassmorphism`)، وسيط خلفي (`Node.js + Express`)، وقاعدة بيانات `Firebase Firestore`، ولوحة تحكم خاصة بالمدير.

## هيكل المشروع
- `backend/` — الخادم الوسيط وجلب بيانات `repo.json` و `TMDB` وربط `Firebase`.
- `frontend/` — الواجهة الأمامية ومشغل الفيديو ولوحة التحكم السرية.

## التشغيل
1. ادخل إلى مجلد الخادم وثبّت الحزم: `cd backend && npm install`
2. انسخ `.env.example` إلى `.env` وأدخل مفاتيح `TMDB_API_KEY` و `ADMIN_SECRET_KEY` و `FIREBASE_SERVICE_ACCOUNT`.
3. شغّل الخادم: `npm start`
4. ارفع مجلد `frontend` على Netlify أو Vercel وحدّث متغير `API_BASE` داخل `frontend/index.html` ليشير إلى رابط الخادم.
