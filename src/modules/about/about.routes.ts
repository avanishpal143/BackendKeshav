import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success } from '../../shared/response.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { isFallback } from '../../shared/dbHelper.js';
import { logger } from '../../shared/logger.js';

const router = Router();

// In-memory fallback store
let aboutContent: AboutContent = getDefaultContent();

interface AboutMember {
  id: string;
  name: string;
  role: string;
  detail?: string;
  image: string; // base64 data URL or asset path
  order: number;
}

interface AboutContent {
  // Inspiration section (top hero)
  inspiration: {
    name: string;
    role: string;
    subtitle: string;
    badge: string;
    image: string;
  };
  // Supporters section
  supporters: AboutMember[];
  // Story/description paragraphs
  story: {
    title: string;
    paragraphs: string[];
  };
  // Quote
  quote: string;
  // Leadership team
  leadership: AboutMember[];
  // Section title for leadership
  leadershipTitle: string;
}

function getDefaultContent(): AboutContent {
  return {
    inspiration: {
      name: 'स्वर्ग वासी श्री सोमी जी',
      role: 'Dreamer • निधन समय 22-02-2026',
      subtitle: 'हमारे प्रेरणास्रोत',
      badge: 'हमारे प्रेरणास्रोत',
      image: '',
    },
    supporters: [
      { id: '1', name: 'श्री नरेश जी', role: 'Supporter', image: '', order: 1 },
      { id: '2', name: 'Ramesh Chand', role: 'Supporter', image: '', order: 2 },
    ],
    story: {
      title: 'Ekta Koli Jatav Vikas Foundation के बारे में',
      paragraphs: [
        'यह संस्था आदरणीय स्वर्ग वासी श्री सोमी जी निधन समय 22-02-2026 (Dreamer) के दूरदर्शी विचारों एवं सपनों से प्रेरित होकर स्थापित की गई है।',
        'इस संस्था के लिए नियम व समाज विकास कार्य पिछले 5 साल से लिखे जा रहे हैं।',
        'साथ ही आदरणीय श्री नरेश जी (Supporter) एवं श्री रमेश जी (Supporter) के निरंतर सहयोग, प्रोत्साहन एवं मार्गदर्शन ने संस्था को समाज सेवा के इस पथ पर आगे बढ़ने की शक्ति प्रदान की है।',
        'इन महान व्यक्तियों के आशीर्वाद, प्रेरणा एवं मार्गदर्शन से यह संस्था समाज के उत्थान, शिक्षा, स्वास्थ्य एवं जनकल्याण के लिए निरंतर कार्यरत है।',
      ],
    },
    quote: '"उनकी सोच हमारी प्रेरणा है, और उनका मार्गदर्शन हमारी शक्ति।" 🙏',
    leadershipTitle: 'संस्था नेतृत्व',
    leadership: [
      { id: '1', name: 'Rakesh Kumar', role: 'Director & Founder', detail: 'समाज विकास के सपने को आगे बढ़ाने के लिए समर्पित।', image: '', order: 1 },
      { id: '2', name: 'Gaje Singh', role: 'Director', detail: 'संस्था के कार्यों और समाज सेवा में सक्रिय नेतृत्व।', image: '', order: 2 },
      { id: '3', name: 'Bane Singh', role: 'Head of Team Coordinator', detail: 'समाज सेवा और संगठन के कार्यों में सहयोगी नेतृत्व।', image: '', order: 3 },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /about — Public: Get about us content
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', async (_req, res, next) => {
  try {
    if (isFallback()) {
      return success(res, aboutContent);
    }

    const row = await queryOne<{ content: string }>(`SELECT content FROM about_content ORDER BY updated_at DESC LIMIT 1`);
    if (row) {
      return success(res, JSON.parse(row.content));
    }
    // No content in DB — return default and save it
    await query(`INSERT INTO about_content (content) VALUES ($1)`, [JSON.stringify(getDefaultContent())]);
    success(res, getDefaultContent());
  } catch (err) {
    logger.warn('About content fetch failed, using defaults:', err);
    success(res, aboutContent);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /about — Admin: Update about us content
// ══════════════════════════════════════════════════════════════════════════════
router.put('/', authenticate, requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const content = req.body;
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ success: false, message: 'Content is required' });
    }

    aboutContent = content as AboutContent;

    if (!isFallback()) {
      const existing = await queryOne<{ id: string }>(`SELECT id FROM about_content LIMIT 1`);
      if (existing) {
        await query(`UPDATE about_content SET content=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(content), existing.id]);
      } else {
        await query(`INSERT INTO about_content (content) VALUES ($1)`, [JSON.stringify(content)]);
      }
    }

    logger.info('[Admin] About Us content updated');
    success(res, content);
  } catch (err) { next(err); }
});

export default router;
