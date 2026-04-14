/**
 * PAYMENT ROUTES - Razorpay Integration
 * 
 * FLOW:
 * 1. Frontend calls POST /api/payment/create-order → gets Razorpay order_id
 * 2. Razorpay payment modal opens on frontend
 * 3. User pays → Razorpay calls POST /api/payment/verify (webhook)
 * 4. Server verifies signature → marks order PAID → clears cart → sends email
 * 
 * REFUND LOGIC:
 * - Customer can cancel within REFUND_WINDOW_MINUTES (default 30 min)
 * - After window, only admin can process refund
 * - Razorpay refund API called automatically within window
 */

const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../config/db');
const { sendOrderEmail } = require('../middleware/email');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Helper: Generate unique order number
async function generateOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM orders WHERE DATE(created_at) = CURDATE()'
  );
  const seq = String(count + 1).padStart(4, '0');
  return `ACX-${date}-${seq}`;
}

// ── POST Create Razorpay Order ──────────────────────────────
router.post('/create-order', async (req, res) => {
  try {
    const { 
      name, email, phone,
      address1, address2, city, state, pincode,
      coupon_id, discount = 0, customer_note
    } = req.body;
    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const appliedDiscount = Number(discount) || 0;

    if (!normalizedName || !normalizedEmail || !phone || !address1 || !city || !state || !pincode) {
      return res.status(400).json({ error: 'Missing required checkout details' });
    }

    // Get cart from session
    const [cartItems] = await db.query(`
      SELECT c.quantity, c.customization_note,
             p.id AS product_id, p.name, p.price, p.stock_qty, p.sku, p.brand
      FROM cart c
      JOIN products p ON c.product_id = p.id
      WHERE c.session_id = ? AND p.is_active = 1
    `, [req.sessionID]);

    if (!cartItems.length) return res.status(400).json({ error: 'Cart is empty' });

    // Validate stock for all items
    for (const item of cartItems) {
      if (item.stock_qty < item.quantity) {
        return res.status(400).json({ 
          error: `"${item.name}" only has ${item.stock_qty} in stock` 
        });
      }
    }

    const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const shipping = subtotal >= 999 ? 0 : 99;
    const total = Math.max(0, subtotal + shipping - appliedDiscount);

    // Create Razorpay order (amount in paise)
    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
      notes: { customer_email: normalizedEmail, customer_name: normalizedName }
    });

    // Create order number
    const orderNumber = await generateOrderNumber();

    // Check if guest user exists, create if not
    let userId = req.session?.user?.id || null;
    if (!userId) {
      // Create or find guest user by email
      const [[existing]] = await db.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
      if (existing) {
        userId = existing.id;
      } else {
        const uuid = require('uuid').v4();
        const [result] = await db.query(`
          INSERT INTO users (uuid, name, email, phone, is_guest)
          VALUES (?, ?, ?, ?, 1)
        `, [uuid, normalizedName, normalizedEmail, phone]);
        userId = result.insertId;
      }
    }

    // Save pending order to DB
    const [orderResult] = await db.query(`
      INSERT INTO orders (
        order_number, user_id, guest_email, guest_name, guest_phone,
        ship_name, ship_phone, ship_address1, ship_address2,
        ship_city, ship_state, ship_pincode,
        subtotal, shipping_charge, discount, total,
        razorpay_order_id, status, payment_status, customer_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?)
    `, [
      orderNumber, userId, normalizedEmail, normalizedName, phone,
      normalizedName, phone, address1, address2, city, state, pincode,
      subtotal, shipping, appliedDiscount, total,
      rzpOrder.id, customer_note
    ]);

    const orderId = orderResult.insertId;

    // Save order items
    for (const item of cartItems) {
      await db.query(`
        INSERT INTO order_items 
          (order_id, product_id, product_name, product_sku, brand, quantity, unit_price, total_price, customization_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [orderId, item.product_id, item.name, item.sku, item.brand,
          item.quantity, item.price, item.price * item.quantity, item.customization_note]);
    }

    // Log status history
    await db.query(`
      INSERT INTO order_status_history (order_id, new_status, note)
      VALUES (?, 'pending', 'Order created, awaiting payment')
    `, [orderId]);

    // Increment coupon usage if applied
    if (coupon_id) {
      await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [coupon_id]);
    }

    res.json({
      success: true,
      razorpay_order_id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      order_number: orderNumber,
      order_id: orderId,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error('Payment create-order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST Verify Payment (called after Razorpay success) ─────
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_number } = req.body;

    // Verify signature (CRITICAL security step)
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed - invalid signature' });
    }

    const paidAt = new Date();
    const refundWindow = parseInt(process.env.REFUND_WINDOW_MINUTES || 30);
    const refundEligibleUntil = new Date(paidAt.getTime() + refundWindow * 60 * 1000);

    // Update order to PAID
    await db.query(`
      UPDATE orders SET
        status = 'paid',
        payment_status = 'paid',
        razorpay_payment_id = ?,
        razorpay_signature = ?,
        paid_at = ?,
        refund_eligible_until = ?
      WHERE razorpay_order_id = ?
    `, [razorpay_payment_id, razorpay_signature, paidAt, refundEligibleUntil, razorpay_order_id]);

    // Get order details
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE razorpay_order_id = ?', [razorpay_order_id]
    );
    if (!order) return res.status(404).json({ error: 'Order record not found' });

    // Deduct stock for all items
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    for (const item of items) {
      await db.query(
        'UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }

    // Clear cart
    await db.query('DELETE FROM cart WHERE session_id = ?', [req.sessionID]);

    // Status history
    await db.query(`
      INSERT INTO order_status_history (order_id, old_status, new_status, note)
      VALUES (?, 'pending', 'paid', 'Payment verified via Razorpay')
    `, [order.id]);

    // Send confirmation email (async, don't wait)
    sendOrderEmail(order, items, 'confirmation').catch(console.error);

    res.json({
      success: true,
      order_number: order.order_number,
      message: 'Payment successful! Order confirmed.',
      refund_window_minutes: refundWindow
    });

  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST Cancel & Refund ────────────────────────────────────
router.post('/cancel', async (req, res) => {
  try {
    const { order_number, email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!order_number || !normalizedEmail) {
      return res.status(400).json({ error: 'order_number and email required' });
    }

    const [[order]] = await db.query(`
      SELECT * FROM orders WHERE order_number = ? AND guest_email = ?
    `, [order_number, normalizedEmail]);

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (['cancelled', 'refunded', 'shipped', 'delivered'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel order in "${order.status}" status` });
    }
    if (order.status === 'pending') {
      // Not paid yet, just cancel
      await db.query(
        'UPDATE orders SET status = "cancelled" WHERE id = ?', [order.id]
      );
      return res.json({ success: true, message: 'Order cancelled' });
    }

    const now = new Date();
    const eligibleUntil = new Date(order.refund_eligible_until);
    const withinWindow = now <= eligibleUntil;

    if (withinWindow && order.razorpay_payment_id) {
      // AUTO REFUND via Razorpay
      const refund = await razorpay.payments.refund(order.razorpay_payment_id, {
        amount: Math.round(order.total * 100),
        notes: { reason: 'Customer cancelled within refund window' }
      });

      await db.query(`
        UPDATE orders SET 
          status = 'refunded', payment_status = 'refunded',
          refund_amount = ?, refund_id = ?, refunded_at = NOW()
        WHERE id = ?
      `, [order.total, refund.id, order.id]);

      await db.query(`
        INSERT INTO order_status_history (order_id, old_status, new_status, note)
        VALUES (?, ?, 'refunded', 'Auto-refund processed within cancellation window')
      `, [order.id, order.status]);

      // Restore stock
      const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      for (const item of items) {
        await db.query(
          'UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?',
          [item.quantity, item.product_id]
        );
      }

      res.json({
        success: true,
        message: `Order cancelled. Refund of ₹${order.total} initiated. Will reach your account in 5-7 business days.`,
        refund_id: refund.id
      });

    } else {
      // Outside window - mark as refund_requested for admin
      await db.query(
        'UPDATE orders SET status = "refund_requested" WHERE id = ?', [order.id]
      );
      await db.query(`
        INSERT INTO order_status_history (order_id, old_status, new_status, note)
        VALUES (?, ?, 'refund_requested', 'Customer requested refund outside auto-window')
      `, [order.id, order.status]);

      res.json({
        success: true,
        message: 'Cancellation request submitted. Our team will review and process your refund within 2-3 business days.'
      });
    }

  } catch (err) {
    console.error('Cancel order error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
