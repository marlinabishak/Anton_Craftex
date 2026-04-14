/**
 * ADMIN ROUTES
 * All routes require is_admin = 1 in session
 * 
 * Dashboard, Orders, Products, Users, Refunds management
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const Razorpay = require('razorpay');
const multer = require('multer');
const path = require('path');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const VALID_PRODUCT_BRANDS = new Set(['patchmagic', 'divine_foods']);
const VALID_CATEGORY_BRANDS = new Set(['patchmagic', 'divine_foods', 'craftex']);

// Admin auth middleware
function adminAuth(req, res, next) {
  if (req.session?.user?.is_admin) return next();
  res.status(403).json({ error: 'Admin access required' });
}

// File upload for product images
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function normalizeImages(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((img) => String(img).trim()).filter(Boolean);
  if (typeof input === 'string') {
    const value = input.trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((img) => String(img).trim()).filter(Boolean);
    } catch {}
    return value.split(',').map((img) => img.trim()).filter(Boolean);
  }
  return [];
}

function normalizeSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIntOrZero(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Admin login (separate from user login)
router.post('/login', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  try {
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const [[user]] = await db.query('SELECT * FROM users WHERE email = ? AND is_admin = 1', [normalizedEmail]);
    if (!user) return res.status(401).json({ error: 'Invalid admin credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid admin credentials' });
    req.session.user = { id: user.id, name: user.name, email: user.email, is_admin: 1 };
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All admin routes require auth
router.use(adminAuth);

// ── GET Dashboard Stats ─────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [[revenue]] = await db.query(`
      SELECT 
        COUNT(*) AS total_orders,
        SUM(CASE WHEN status NOT IN ('cancelled','refunded') THEN total ELSE 0 END) AS total_revenue,
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS orders_today,
        SUM(CASE WHEN status = 'refund_requested' THEN 1 ELSE 0 END) AS pending_refunds
      FROM orders WHERE payment_status = 'paid'
    `);

    const [[users]] = await db.query(`
      SELECT COUNT(*) AS total_users, 
             SUM(is_guest) AS guests,
             SUM(CASE WHEN is_guest=0 THEN 1 ELSE 0 END) AS registered
      FROM users WHERE is_admin = 0
    `);

    const [low_stock] = await db.query(
      'SELECT id, name, stock_qty FROM products WHERE stock_qty < 10 AND is_active = 1 ORDER BY stock_qty ASC'
    );

    const [recent_orders] = await db.query(`
      SELECT order_number, guest_name, total, status, created_at
      FROM orders ORDER BY created_at DESC LIMIT 10
    `);

    res.json({ revenue: revenue[0], users: users[0], low_stock, recent_orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET All Orders ──────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (status) { where += ' AND o.status = ?'; params.push(status); }

    const [orders] = await db.query(`
      SELECT o.*, COUNT(oi.id) AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ${where}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, +limit, +offset]);

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT Update Order Status ─────────────────────────────────
router.put('/orders/:id/status', async (req, res) => {
  try {
    const { status, note, tracking_number, courier_name } = req.body;
    const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updates = { status };
    if (tracking_number) updates.tracking_number = tracking_number;
    if (courier_name) updates.courier_name = courier_name;
    if (status === 'shipped') updates.shipped_at = new Date();
    if (status === 'delivered') updates.delivered_at = new Date();

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE orders SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), req.params.id]
    );

    await db.query(`
      INSERT INTO order_status_history (order_id, old_status, new_status, note, changed_by)
      VALUES (?, ?, ?, ?, 'admin')
    `, [req.params.id, order.status, status, note]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Process Manual Refund ──────────────────────────────
router.post('/orders/:id/refund', async (req, res) => {
  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order || !order.razorpay_payment_id) {
      return res.status(400).json({ error: 'Order not refundable' });
    }

    const refund = await razorpay.payments.refund(order.razorpay_payment_id, {
      amount: Math.round(order.total * 100),
      notes: { reason: 'Admin manual refund' }
    });

    await db.query(`
      UPDATE orders SET status='refunded', payment_status='refunded',
        refund_amount=?, refund_id=?, refunded_at=NOW()
      WHERE id=?
    `, [order.total, refund.id, order.id]);

    // Restore stock
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    for (const item of items) {
      await db.query('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    res.json({ success: true, refund_id: refund.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET All Products (admin) ────────────────────────────────
router.get('/products', async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT p.*, c.name AS category_name FROM products p
      JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
    `);
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET All Categories (admin) ───────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const [categories] = await db.query(`
      SELECT c.*,
             COUNT(p.id) AS product_count,
             SUM(CASE WHEN p.is_active = 1 THEN 1 ELSE 0 END) AS active_product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC
    `);
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Add Product ────────────────────────────────────────
router.post('/products', upload.array('images', 5), async (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { category_id, name, brand, short_description, description,
            price, price_min, price_max, mrp, stock_qty, sku, material,
            origin, artisan_story, is_featured, is_customizable, tags, images } = req.body;

    const productName = String(name || '').trim();
    const productBrand = String(brand || '').trim().toLowerCase();
    const categoryId = toIntOrZero(category_id);
    const priceValue = Number(price);
    const stockValue = toIntOrZero(stock_qty);
    const mrpValue = toNumberOrNull(mrp);

    if (!productName || !VALID_PRODUCT_BRANDS.has(productBrand) || !categoryId || !Number.isFinite(priceValue)) {
      return res.status(400).json({ error: 'Name, brand, category and price are required' });
    }

    const [[category]] = await db.query('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const slug = normalizeSlug(productName);
    const uploadedImages = req.files?.map(f => `/uploads/${f.filename}`) || [];
    const directImages = normalizeImages(images).map((img) => img.startsWith('/') ? img : (img.includes('/') ? img : `/uploads/${img}`));
    const finalImages = uploadedImages.length ? [...uploadedImages, ...directImages] : directImages;

    await db.query(`
      INSERT INTO products (uuid, category_id, name, slug, brand, short_description, description,
        price, price_min, price_max, mrp, stock_qty, sku, material, origin, artisan_story,
        images, is_featured, is_customizable, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [uuidv4(), categoryId, productName, slug, productBrand, short_description, description,
        priceValue, toNumberOrNull(price_min), toNumberOrNull(price_max), mrpValue, stockValue, sku,
        material, origin, artisan_story, JSON.stringify(finalImages),
        is_featured ? 1 : 0, is_customizable ? 1 : 0, tags]);

    res.json({ success: true, message: 'Product added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT Update Product ──────────────────────────────────────
router.put('/products/:id', upload.array('images', 5), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const { category_id, name, brand, short_description, description, price, price_min, price_max, mrp,
            stock_qty, sku, material, origin, artisan_story, is_active, is_featured, is_customizable,
            tags, images } = req.body;

    const nextName = String(name || existing.name || '').trim();
    const nextBrand = String(brand || existing.brand || '').trim().toLowerCase();
    const nextCategoryId = toIntOrZero(category_id || existing.category_id);
    const nextPrice = Number(price ?? existing.price);
    const nextStock = toIntOrZero(stock_qty ?? existing.stock_qty);
    const nextMrp = mrp === undefined || mrp === '' ? existing.mrp : toNumberOrNull(mrp);
    const nextPriceMin = price_min === undefined || price_min === '' ? existing.price_min : toNumberOrNull(price_min);
    const nextPriceMax = price_max === undefined || price_max === '' ? existing.price_max : toNumberOrNull(price_max);
    const nextIsActive = is_active === undefined ? existing.is_active : Number(is_active) ? 1 : 0;
    const nextIsFeatured = is_featured === undefined ? existing.is_featured : Number(is_featured) ? 1 : 0;
    const nextIsCustomizable = is_customizable === undefined ? existing.is_customizable : Number(is_customizable) ? 1 : 0;

    if (!nextName || !VALID_PRODUCT_BRANDS.has(nextBrand) || !nextCategoryId || !Number.isFinite(nextPrice)) {
      return res.status(400).json({ error: 'Name, brand, category and price are required' });
    }

    const [[category]] = await db.query('SELECT id FROM categories WHERE id = ?', [nextCategoryId]);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const uploadedImages = req.files?.map(f => `/uploads/${f.filename}`) || [];
    const directImages = normalizeImages(images).map((img) => img.startsWith('/') ? img : (img.includes('/') ? img : `/uploads/${img}`));
    const preservedImages = normalizeImages(existing.images);
    const nextImages = (uploadedImages.length || directImages.length) ? [...uploadedImages, ...directImages] : preservedImages;

    await db.query(`
      UPDATE products SET category_id=?, name=?, slug=?, brand=?, short_description=?, description=?,
        price=?, price_min=?, price_max=?, mrp=?, stock_qty=?, sku=?, material=?, origin=?, artisan_story=?,
        images=?, is_active=?, is_featured=?, is_customizable=?, tags=? WHERE id=?
    `, [
      nextCategoryId,
      nextName,
      normalizeSlug(nextName),
      nextBrand,
      short_description ?? existing.short_description,
      description ?? existing.description,
      nextPrice,
      nextPriceMin,
      nextPriceMax,
      nextMrp,
      nextStock,
      sku ?? existing.sku,
      material ?? existing.material,
      origin ?? existing.origin,
      artisan_story ?? existing.artisan_story,
      JSON.stringify(nextImages),
      nextIsActive,
      nextIsFeatured,
      nextIsCustomizable,
      tags ?? existing.tags,
      req.params.id
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE Product ──────────────────────────────────────────
router.delete('/products/:id', async (req, res) => {
  try {
    const [[product]] = await db.query('SELECT id, name, is_active FROM products WHERE id = ?', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const [[usage]] = await db.query('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?', [req.params.id]);
    await db.query('DELETE FROM cart WHERE product_id = ?', [req.params.id]);

    if (Number(usage.count) > 0) {
      await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);
      return res.json({ success: true, action: 'deactivated', message: 'Product has order history and was deactivated instead of deleted.' });
    }

    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true, action: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Category ───────────────────────────────────────────
router.post('/categories', async (req, res) => {
  try {
    const { name, slug, brand, description, image_url, sort_order, is_active } = req.body;
    const categoryName = String(name || '').trim();
    const categoryBrand = String(brand || '').trim().toLowerCase();
    const nextSlug = normalizeSlug(slug || categoryName);

    if (!categoryName || !VALID_CATEGORY_BRANDS.has(categoryBrand) || !nextSlug) {
      return res.status(400).json({ error: 'Name, slug and brand are required' });
    }

    const [[exists]] = await db.query('SELECT id FROM categories WHERE slug = ?', [nextSlug]);
    if (exists) return res.status(409).json({ error: 'Category slug already exists' });

    await db.query(`
      INSERT INTO categories (name, slug, brand, description, image_url, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [categoryName, nextSlug, categoryBrand, description || null, image_url || null, toIntOrZero(sort_order), is_active === undefined ? 1 : (Number(is_active) ? 1 : 0)]);

    res.json({ success: true, message: 'Category added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT Category ────────────────────────────────────────────
router.put('/categories/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const { name, slug, brand, description, image_url, sort_order, is_active } = req.body;
    const categoryName = String(name ?? existing.name).trim();
    const categoryBrand = String(brand ?? existing.brand).trim().toLowerCase();
    const nextSlug = normalizeSlug(slug || categoryName || existing.slug);

    if (!categoryName || !VALID_CATEGORY_BRANDS.has(categoryBrand) || !nextSlug) {
      return res.status(400).json({ error: 'Name, slug and brand are required' });
    }

    const [[conflict]] = await db.query('SELECT id FROM categories WHERE slug = ? AND id <> ?', [nextSlug, req.params.id]);
    if (conflict) return res.status(409).json({ error: 'Category slug already exists' });

    await db.query(`
      UPDATE categories
      SET name=?, slug=?, brand=?, description=?, image_url=?, sort_order=?, is_active=?
      WHERE id=?
    `, [
      categoryName,
      nextSlug,
      categoryBrand,
      description ?? existing.description,
      image_url ?? existing.image_url,
      sort_order === undefined ? existing.sort_order : toIntOrZero(sort_order),
      is_active === undefined ? existing.is_active : (Number(is_active) ? 1 : 0),
      req.params.id
    ]);

    res.json({ success: true, message: 'Category updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE Category ─────────────────────────────────────────
router.delete('/categories/:id', async (req, res) => {
  try {
    const [[category]] = await db.query('SELECT id, name FROM categories WHERE id = ?', [req.params.id]);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const [[usage]] = await db.query('SELECT COUNT(*) AS count FROM products WHERE category_id = ?', [req.params.id]);
    if (Number(usage.count) > 0) {
      await db.query('UPDATE categories SET is_active = 0 WHERE id = ?', [req.params.id]);
      return res.json({ success: true, action: 'deactivated', message: 'Category is linked to products and was deactivated instead of deleted.' });
    }

    await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ success: true, action: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET All Users ───────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const [users] = await db.query(`
      SELECT u.id, u.name, u.email, u.phone, u.is_guest, u.created_at,
             COUNT(o.id) AS order_count,
             SUM(CASE WHEN o.payment_status='paid' THEN o.total ELSE 0 END) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.is_admin = 0
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Craft Park Enquiries ────────────────────────────────
router.get('/enquiries', async (req, res) => {
  try {
    const [enquiries] = await db.query('SELECT * FROM craft_park_enquiries ORDER BY created_at DESC');
    res.json({ enquiries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT Approve Review ──────────────────────────────────────
router.put('/reviews/:id/approve', async (req, res) => {
  try {
    await db.query('UPDATE reviews SET is_approved = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
