/**
 * CART ROUTES - Server-side session cart
 * 
 * WHY SESSION CART (not localStorage)?
 * - localStorage persists even after browser close = shows old products
 * - Session cart lives on server, tied to browser session ID
 * - When user closes browser and reopens = new session = empty cart
 * - This fixes the "showing previous products" bug described by client
 * 
 * GET  /api/cart          - Get current cart
 * POST /api/cart/add      - Add item to cart
 * PUT  /api/cart/update   - Update quantity
 * DELETE /api/cart/remove - Remove item
 * DELETE /api/cart/clear  - Clear entire cart
 * POST /api/cart/coupon   - Apply coupon code
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Helper: Get cart with full product details from DB
async function getCartWithDetails(sessionId) {
  const [items] = await db.query(`
    SELECT c.id, c.product_id, c.quantity, c.customization_note,
           p.name, p.slug, p.brand, p.price, p.mrp, p.images, 
           p.stock_qty, p.is_customizable
    FROM cart c
    JOIN products p ON c.product_id = p.id
    WHERE c.session_id = ? AND p.is_active = 1
  `, [sessionId]);

  const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const shipping = subtotal >= 999 ? 0 : 99; // Free shipping over ₹999
  const total = subtotal + shipping;

  const item_count = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return { items, subtotal, shipping, total, item_count };
}

// ── GET Cart ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const cart = await getCartWithDetails(req.sessionID);
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Add to Cart ────────────────────────────────────────
router.post('/add', async (req, res) => {
  try {
    const { product_id, quantity = 1, customization_note } = req.body;
    const delta = Number(quantity) || 0;

    if (!product_id || !delta) {
      const cart = await getCartWithDetails(req.sessionID);
      return res.json({ success: true, cart });
    }

    // Validate product exists and has stock
    const [[product]] = await db.query(
      'SELECT id, stock_qty, price FROM products WHERE id = ? AND is_active = 1',
      [product_id]
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const [[existing]] = await db.query(
      'SELECT quantity FROM cart WHERE session_id = ? AND product_id = ?',
      [req.sessionID, product_id]
    );
    const currentQty = Number(existing?.quantity || 0);
    const nextQty = currentQty + delta;

    if (delta > 0 && nextQty > product.stock_qty) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    if (nextQty <= 0) {
      await db.query('DELETE FROM cart WHERE session_id = ? AND product_id = ?', [req.sessionID, product_id]);
    } else if (currentQty > 0) {
      await db.query(
        'UPDATE cart SET quantity = ?, customization_note = COALESCE(?, customization_note), user_id = COALESCE(?, user_id) WHERE session_id = ? AND product_id = ?',
        [nextQty, customization_note || null, req.session?.user?.id || null, req.sessionID, product_id]
      );
    } else {
      await db.query(
        'INSERT INTO cart (session_id, user_id, product_id, quantity, customization_note) VALUES (?, ?, ?, ?, ?)',
        [req.sessionID, req.session?.user?.id || null, product_id, nextQty, customization_note || null]
      );
    }

    const cart = await getCartWithDetails(req.sessionID);
    res.json({ success: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT Update Cart Item Quantity ───────────────────────────
router.put('/update', async (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    if (quantity <= 0) {
      await db.query(
        'DELETE FROM cart WHERE session_id = ? AND product_id = ?',
        [req.sessionID, product_id]
      );
    } else {
      // Check stock
      const [[product]] = await db.query(
        'SELECT stock_qty FROM products WHERE id = ?', [product_id]
      );
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      if (product.stock_qty < quantity) {
        return res.status(400).json({ error: `Only ${product.stock_qty} in stock` });
      }
      await db.query(
        'UPDATE cart SET quantity = ? WHERE session_id = ? AND product_id = ?',
        [quantity, req.sessionID, product_id]
      );
    }

    const cart = await getCartWithDetails(req.sessionID);
    res.json({ success: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE Remove Item ──────────────────────────────────────
router.delete('/remove/:product_id', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM cart WHERE session_id = ? AND product_id = ?',
      [req.sessionID, req.params.product_id]
    );
    const cart = await getCartWithDetails(req.sessionID);
    res.json({ success: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backward-compatible alias for older frontend calls
router.post('/remove', async (req, res) => {
  try {
    const productId = req.body?.product_id;
    await db.query(
      'DELETE FROM cart WHERE session_id = ? AND product_id = ?',
      [req.sessionID, productId]
    );
    const cart = await getCartWithDetails(req.sessionID);
    res.json({ success: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE Clear Cart ───────────────────────────────────────
router.delete('/clear', async (req, res) => {
  try {
    await db.query('DELETE FROM cart WHERE session_id = ?', [req.sessionID]);
    res.json({ success: true, cart: { items: [], subtotal: 0, shipping: 0, total: 0, item_count: 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Apply Coupon ───────────────────────────────────────
router.post('/coupon', async (req, res) => {
  try {
    const { code } = req.body;
    const couponCode = String(code || '').trim();
    if (!couponCode) {
      return res.status(400).json({ error: 'Coupon code required' });
    }
    const cart = await getCartWithDetails(req.sessionID);

    const [[coupon]] = await db.query(`
      SELECT * FROM coupons 
      WHERE code = ? AND is_active = 1 
      AND (expires_at IS NULL OR expires_at > NOW())
      AND used_count < max_uses
    `, [couponCode.toUpperCase()]);

    if (!coupon) return res.status(400).json({ error: 'Invalid or expired coupon' });
    if (cart.subtotal < coupon.min_order) {
      return res.status(400).json({ 
        error: `Minimum order ₹${coupon.min_order} required for this coupon` 
      });
    }

    let discount = 0;
    if (coupon.type === 'percent') {
      discount = (cart.subtotal * coupon.value) / 100;
    } else {
      discount = coupon.value;
    }

    res.json({
      success: true,
      coupon_id: coupon.id,
      code: coupon.code,
      discount: Math.round(discount),
      new_total: Math.max(0, cart.subtotal + cart.shipping - discount)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
