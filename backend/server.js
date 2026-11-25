require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const admin = require('firebase-admin');

const app = express();
const cache = new NodeCache({ stdTTL: 600 });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 1. تهيئة Firebase Firestore
let db = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ تم الاتصال بقاعدة بيانات Firebase Firestore بنجاح');
  } else {
    console.warn('⚠️ تنبيه: متغير FIREBASE_SERVICE_ACCOUNT غير مضبوط. سيعمل الخادم بوضع الذاكرة المؤقتة.');
  }
} catch (err) {
  console.error('❌ خطأ في تهيئة Firebase:', err.message);
}

const TMDB_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const DEFAULT_REPO = process.env.REPO_DEFAULT_URL || 'https://raw.githubusercontent.com/mo7AmMeD64/cs-ar/main/repo/repo.json';
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'MOFLVFLY_ADMIN_2026';

// 2. وسيط التحقق من صلاحيات المدير
const verifyAdmin = (req, res, next) => {
  const token = req.headers['x-admin-secret'];
  if (!token || token !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'غير مصرح لك بالوصول إلى لوحة التحكم' });
  }
  next();
};

// 3. مسار قراءة مستودع الإضافات (repo.json)
app.get('/api/repo-sources', async (req, res) => {
  try {
    const cached = cache.get('repo_sources');
    if (cached) return res.json(cached);

    const repoResponse = await axios.get(DEFAULT_REPO, { timeout: 8000 });
    const mainRepo = repoResponse.data;

    let extractedPlugins = [];
    if (Array.isArray(mainRepo.pluginLists)) {
      for (const listUrl of mainRepo.pluginLists) {
        try {
          const listRes = await axios.get(listUrl, { timeout: 6000 });
          if (Array.isArray(listRes.data)) {
            extractedPlugins = extractedPlugins.concat(listRes.data);
          }
        } catch (e) {
          console.warn(`تعذر جلب قائمة الملحقات من: ${listUrl}`);
        }
      }
    }

    let customRepos = [];
    if (db) {
      const snap = await db.collection('repo_sources').get();
      customRepos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    const result = {
      success: true,
      repoInfo: {
        name: mainRepo.name || 'CS-AR Repository',
        description: mainRepo.description || '',
        url: DEFAULT_REPO
      },
      plugins: extractedPlugins,
      customRepos
    };

    cache.set('repo_sources', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: 'فشل في جلب بيانات المستودع', details: error.message });
  }
});

// 4. مسار جلب الكتالوج (دمج Firebase + TMDB)
app.get('/api/catalog', async (req, res) => {
  try {
    const type = req.query.type || 'all';
    const cacheKey = `catalog_${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let customItems = [];
    let pinnedConfig = { top10Ids: [], featuredIds: [] };

    if (db) {
      const itemsSnap = await db.collection('movies_series').get();
      customItems = itemsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        isCustom: true
      }));

      const pinnedDoc = await db.collection('pinned_home').doc('main').get();
      if (pinnedDoc.exists) {
        pinnedConfig = pinnedDoc.data();
      }
    }

    let tmdbItems = [];
    if (TMDB_KEY) {
      const endpoint = type === 'all' ? '/trending/all/week' : `/trending/${type}/week`;
      const tmdbRes = await axios.get(`${TMDB_BASE}${endpoint}`, {
        params: { api_key: TMDB_KEY, language: 'ar-SA' }
      });

      tmdbItems = (tmdbRes.data.results || [])
        .filter(item => item.media_type !== 'person')
        .map(item => ({
          id: String(item.id),
          title: item.title || item.name,
          originalTitle: item.original_title || item.original_name,
          type: item.media_type || (type === 'all' ? 'movie' : type),
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : '',
          rating: item.vote_average ? item.vote_average.toFixed(1) : '8.0',
          year: (item.release_date || item.first_air_date || '2026').split('-')[0],
          overview: item.overview || 'لا يتوفر وصف باللغة العربية حالياً.',
          streams: [],
          subtitles: [],
          isCustom: false
        }));
    }

    const customMap = new Map(customItems.map(item => [String(item.id), item]));
    const filteredTmdb = tmdbItems.filter(item => !customMap.has(String(item.id)));
    let merged = [...customItems, ...filteredTmdb];

    if (type !== 'all') {
      merged = merged.filter(item => item.type === type);
    }

    const responsePayload = {
      success: true,
      items: merged,
      pinned: pinnedConfig
    };

    cache.set(cacheKey, responsePayload, 300);
    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطأ في جلب قائمة الأعمال', details: error.message });
  }
});

// 5. مسار جلب روابط البث والترجمات لعمل محدد
app.get('/api/stream/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const season = req.query.season || 1;
    const episode = req.query.episode || 1;

    if (db) {
      const doc = await db.collection('movies_series').doc(String(id)).get();
      if (doc.exists) {
        const data = doc.data();
        if (data.type === 'tv' && data.episodes && data.episodes[`S${season}E${episode}`]) {
          const epData = data.episodes[`S${season}E${episode}`];
          return res.json({
            success: true,
            streams: epData.streams || [],
            subtitles: epData.subtitles || []
          });
        }
        return res.json({
          success: true,
          streams: data.streams || [],
          subtitles: data.subtitles || []
        });
      }
    }

    res.json({
      success: true,
      streams: [],
      subtitles: [],
      message: 'لم يتم ربط سيرفر بث لهذا العمل بعد. يمكنك إضافته من لوحة التحكم.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'فشل جلب روابط البث' });
  }
});

// 6. مسارات لوحة التحكم المحمية
app.post('/api/admin/login', verifyAdmin, (req, res) => {
  res.json({ success: true, message: 'تم التحقق بنجاح' });
});

app.post('/api/admin/save-item', verifyAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'قاعدة بيانات Firebase غير متصلة' });

    const payload = req.body;
    const docId = payload.id ? String(payload.id) : db.collection('movies_series').doc().id;

    await db.collection('movies_series').doc(docId).set({
      ...payload,
      id: docId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    cache.flushAll();
    res.json({ success: true, id: docId, message: 'تم حفظ العمل بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/delete-item/:id', verifyAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'قاعدة بيانات Firebase غير متصلة' });

    await db.collection('movies_series').doc(req.params.id).delete();
    cache.flushAll();
    res.json({ success: true, message: 'تم حذف العمل بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/pin-home', verifyAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'قاعدة بيانات Firebase غير متصلة' });

    const { top10Ids, featuredIds } = req.body;
    await db.collection('pinned_home').doc('main').set({
      top10Ids: top10Ids || [],
      featuredIds: featuredIds || [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    cache.flushAll();
    res.json({ success: true, message: 'تم تحديث واجهة الموقع وقائمة Top 10' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/repo-source', verifyAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'قاعدة بيانات Firebase غير متصلة' });

    const { name, url, active } = req.body;
    const docRef = await db.collection('repo_sources').add({
      name,
      url,
      active: active !== false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    cache.del('repo_sources');
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 خادم MOFLVFLY الوسيط يعمل الآن على المنفذ: http://localhost:${PORT}`);
});
