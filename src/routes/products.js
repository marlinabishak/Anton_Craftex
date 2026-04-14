/**
 * PRODUCTS ROUTES
 * GET /api/products           - List products (filter, paginate, sort)
 * GET /api/products/search    - Full-text search
 * GET /api/products/categories- All categories
 * GET /api/products/slug/:slug- Single product detail
 * POST /api/products/:id/review - Submit review
 */
const express = require('express');
const router  = express.Router();
const db = require('../config/db');

function normalizeImages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((img) => String(img).trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((img) => String(img).trim()).filter(Boolean);
    } catch {}
    return trimmed.split(',').map((img) => img.trim()).filter(Boolean);
  }
  return [];
}

function normalizeImagePath(img) {
  if (!img) return '';
  const value = String(img).trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) return value;
  return `/uploads/${value}`;
}

function resolveImages(value) {
  return normalizeImages(value).map(normalizeImagePath).filter(Boolean);
}

// ── GET All Products ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { brand, category, featured, page = 1, limit = 20, sort = 'newest' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['p.is_active = 1'];
    const params = [];

    if (brand)    { where.push('p.brand = ?');  params.push(brand); }
    if (category) { where.push('c.slug = ?');   params.push(category); }
    if (featured) { where.push('p.is_featured = 1'); }

    const sortMap = {
      price_asc:  'p.price ASC',
      price_desc: 'p.price DESC',
      newest:     'p.created_at DESC',
      name:       'p.name ASC'
    };
    const orderBy = sortMap[sort] || 'p.created_at DESC';

    const [products] = await db.query(`
      SELECT p.id, p.uuid, p.name, p.slug, p.brand, p.short_description,
             p.price, p.price_min, p.price_max, p.mrp, p.stock_qty,
             p.images, p.is_featured, p.is_customizable, p.origin, p.tags,
             c.name AS category_name, c.slug AS category_slug
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) AS total FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE ${where.join(' AND ')}
    `, params);

    // Parse images JSON
    products.forEach((p) => { p.images = resolveImages(p.images); });

    res.json({
      products,
      pagination: {
        page:  parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Search ──────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ products: [] });

    const [products] = await db.query(`
      SELECT p.id, p.name, p.slug, p.brand, p.price, p.images, p.short_description,
             c.name AS category_name,
             MATCH(p.name, p.short_description, p.tags) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
        AND MATCH(p.name, p.short_description, p.tags) AGAINST(? IN NATURAL LANGUAGE MODE)
      ORDER BY relevance DESC
      LIMIT 20
    `, [q, q]);

    products.forEach((p) => { p.images = resolveImages(p.images); });

    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Categories ──────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const [categories] = await db.query(`
      SELECT c.*, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.sort_order
    `);
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Single Product by Slug ──────────────────────────────
router.get('/slug/:slug', async (req, res) => {
  try {
    const [[product]] = await db.query(`
      SELECT p.*,
             c.name AS category_name, c.slug AS category_slug,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM products p
      JOIN categories c ON p.category_id = c.id
      LEFT JOIN reviews r ON r.product_id = p.id AND r.is_approved = 1
      WHERE p.slug = ? AND p.is_active = 1
      GROUP BY p.id
    `, [req.params.slug]);

    if (!product) return res.status(404).json({ error: 'Product not found' });

    product.images = resolveImages(product.images);

    const [reviews] = await db.query(`
      SELECT r.*, u.name AS user_name FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.product_id = ? AND r.is_approved = 1
      ORDER BY r.created_at DESC LIMIT 10
    `, [product.id]);

    product.reviews = reviews;
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Submit Review ──────────────────────────────────────
router.post('/:id/review', async (req, res) => {
  try {
    const { rating, title, body, guest_name } = req.body;
    const user_id = req.session?.user?.id || null;

    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });

    await db.query(`
      INSERT INTO reviews (product_id, user_id, guest_name, rating, title, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [req.params.id, user_id, guest_name, rating, title, body]);

    res.json({ success: true, message: 'Thank you! Your review is pending moderation.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
