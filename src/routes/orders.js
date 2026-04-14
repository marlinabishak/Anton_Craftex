/**
 * ORDERS ROUTES
 * 
 * Guest users can view orders by email + order_number
 * Registered users see all their orders
 * 
 * GET  /api/orders/track         - Track order by email + order_number (guest)
 * GET  /api/orders/my-orders     - All orders for logged-in user
 * GET  /api/orders/:order_number - Single order detail
 * POST /api/orders/otp           - Send OTP to email for guest history
 * POST /api/orders/verify-otp    - Verify OTP, return all guest orders
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendOTPEmail } = require('../middleware/email');

// Helper: Get full order with items
async function getOrderDetail(orderId) {
  const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return null;
  
  const [items] = await db.query(`
    SELECT oi.*, p.images, p.slug FROM order_items oi
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `, [orderId]);

  const [history] = await db.query(`
    SELECT * FROM order_status_history WHERE order_id = ? ORDER BY changed_at ASC
  `, [orderId]);

  return { ...order, items, status_history: history };
}

// ── GET Track Order (guest-friendly, no auth needed) ────────
router.get('/track', async (req, res) => {
  try {
    const { order_number, email } = req.query;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!order_number || !normalizedEmail) {
      return res.status(400).json({ error: 'order_number and email required' });
    }

    const [[order]] = await db.query(`
      SELECT id FROM orders WHERE order_number = ? AND guest_email = ?
    `, [order_number, normalizedEmail]);

    if (!order) return res.status(404).json({ error: 'Order not found. Check your order number and email.' });

    const detail = await getOrderDetail(order.id);
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Send OTP for Guest Order History ────────────────────
router.post('/otp', async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ error: 'Email required' });

    // Check if guest has any orders
    const [[user]] = await db.query(
      'SELECT id FROM users WHERE email = ?', [normalizedEmail]
    );
    if (!user) return res.status(404).json({ error: 'No orders found for this email' });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.query(
      'UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE email = ?',
      [otp, expiresAt, normalizedEmail]
    );

    // Send OTP email
    await sendOTPEmail(normalizedEmail, otp);

    res.json({ success: true, message: 'OTP sent to your email (valid 10 min)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST Verify OTP, Return Guest Order History ──────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    const [[user]] = await db.query(`
      SELECT id FROM users 
      WHERE email = ? AND otp_code = ? AND otp_expires_at > NOW()
    `, [normalizedEmail, otp]);

    if (!user) return res.status(400).json({ error: 'Invalid or expired OTP' });

    // Clear OTP
    await db.query('UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?', [user.id]);

    // Return all orders for this user
    const [orders] = await db.query(`
      SELECT o.order_number, o.status, o.total, o.created_at, o.paid_at,
             o.tracking_number, o.courier_name,
             COUNT(oi.id) AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [user.id]);

    // Store in session for subsequent requests
    req.session.guest_user_id = user.id;
    req.session.guest_email = normalizedEmail;

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Logged-in User Order History ─────────────────────────
router.get('/my-orders', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const [orders] = await db.query(`
      SELECT o.order_number, o.status, o.total, o.created_at, o.paid_at,
             o.tracking_number, o.courier_name,
             COUNT(oi.id) AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [userId]);

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Single Order Detail ──────────────────────────────────
router.get('/:order_number', async (req, res) => {
  try {
    const { order_number } = req.params;
    
    // Auth check: session user, guest session, or query email
    const userId = req.session?.user?.id || req.session?.guest_user_id;
    const queryEmail = String(req.query.email || '').trim().toLowerCase();

    let whereClause = 'order_number = ?';
    const params = [order_number];

    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    } else if (queryEmail) {
      whereClause += ' AND guest_email = ?';
      params.push(queryEmail);
    } else {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const [[order]] = await db.query(`SELECT id FROM orders WHERE ${whereClause}`, params);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const detail = await getOrderDetail(order.id);
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
