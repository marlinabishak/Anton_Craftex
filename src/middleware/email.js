/**
 * EMAIL UTILITY - Nodemailer (Gmail SMTP)
 * ============================================================
 * Sends:
 *  - Order confirmation emails (with itemized receipt)
 *  - OTP emails (for guest order history access)
 *  - Shipping update emails
 *
 * If SMTP not configured, logs to console (safe for dev mode).
 * ============================================================
 */

const nodemailer = require('nodemailer');

// Create transporter (reused across requests for performance)
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Connection pool for high volume
  pool:            true,
  maxConnections:  5,
  maxMessages:     100,
});

// Check if email is configured
function isEmailConfigured() {
  return (
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_USER !== 'your_gmail@gmail.com' &&
    process.env.SMTP_PASS !== 'your_16char_app_password'
  );
}

// ── ORDER CONFIRMATION / UPDATE EMAIL ─────────────────────
async function sendOrderEmail(order, items, type = 'confirmation') {
  if (!isEmailConfigured()) {
    console.log(`[Email] SMTP not configured. Skipping ${type} email for ${order.guest_email}`);
    return;
  }

  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee">${i.product_name}
        ${i.customization_note ? `<br><small style="color:#888">Note: ${i.customization_note}</small>` : ''}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">₹${Number(i.unit_price).toLocaleString('en-IN')}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">₹${Number(i.total_price).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  const subject = type === 'confirmation'
    ? `✅ Order Confirmed - ${order.order_number} | Anton Craftex`
    : `📦 Order Update - ${order.order_number} | Anton Craftex`;

  const statusMessages = {
    paid:        'Your order has been confirmed and is being prepared.',
    processing:  'Your order is being packed and will be shipped soon.',
    shipped:     `Your order has been shipped! ${order.tracking_number ? `Tracking: ${order.courier_name} - ${order.tracking_number}` : ''}`,
    delivered:   'Your order has been delivered. Thank you for shopping with us!',
    refunded:    'Your refund has been processed and will reach your account in 5-7 business days.',
    cancelled:   'Your order has been cancelled.',
  };

  const statusMsg = statusMessages[order.status] || 'Your order status has been updated.';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f9f9f9">
      <div style="max-width:600px;margin:0 auto;background:#fff">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#2d5016,#4a7c28);padding:30px 20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:28px">🌿 Anton Craftex</h1>
          <p style="color:#c8e6c9;margin:8px 0 0;font-size:14px">Craft Park · PatchMagic · Divine Foods</p>
        </div>

        <!-- Body -->
        <div style="padding:30px 25px">
          <h2 style="color:#2d5016;margin-top:0">
            ${type === 'confirmation' ? '✅ Order Confirmed!' : '📦 Order Update'}
          </h2>
          <p>Dear <strong>${order.ship_name}</strong>,</p>
          <p style="color:#555">${statusMsg}</p>

          <!-- Order Info -->
          <div style="background:#f0f7e6;padding:15px 20px;border-radius:8px;margin:20px 0;border-left:4px solid #2d5016">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:4px 0;color:#555">Order Number</td>
                <td style="padding:4px 0;font-weight:bold;text-align:right">${order.order_number}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#555">Status</td>
                <td style="padding:4px 0;font-weight:bold;text-align:right;text-transform:capitalize">${order.status}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#555">Order Date</td>
                <td style="padding:4px 0;text-align:right">${new Date(order.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}</td>
              </tr>
              ${order.tracking_number ? `
              <tr>
                <td style="padding:4px 0;color:#555">Tracking</td>
                <td style="padding:4px 0;text-align:right">${order.courier_name} — ${order.tracking_number}</td>
              </tr>` : ''}
            </table>
          </div>

          <!-- Items Table -->
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <thead>
              <tr style="background:#2d5016;color:#fff">
                <th style="padding:10px 8px;text-align:left;font-weight:normal">Product</th>
                <th style="padding:10px 8px;text-align:center;font-weight:normal">Qty</th>
                <th style="padding:10px 8px;text-align:right;font-weight:normal">Price</th>
                <th style="padding:10px 8px;text-align:right;font-weight:normal">Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>

          <!-- Pricing Summary -->
          <div style="text-align:right;padding:15px 0;border-top:2px solid #eee">
            <table style="margin-left:auto">
              <tr>
                <td style="padding:3px 20px 3px 0;color:#555">Subtotal</td>
                <td style="padding:3px 0;text-align:right">₹${Number(order.subtotal).toLocaleString('en-IN')}</td>
              </tr>
              <tr>
                <td style="padding:3px 20px 3px 0;color:#555">Shipping</td>
                <td style="padding:3px 0;text-align:right">${Number(order.shipping_charge) === 0 ? '<span style="color:#2d5016">FREE</span>' : `₹${Number(order.shipping_charge).toLocaleString('en-IN')}`}</td>
              </tr>
              ${Number(order.discount) > 0 ? `
              <tr>
                <td style="padding:3px 20px 3px 0;color:#e74c3c">Discount</td>
                <td style="padding:3px 0;text-align:right;color:#e74c3c">−₹${Number(order.discount).toLocaleString('en-IN')}</td>
              </tr>` : ''}
              <tr>
                <td style="padding:10px 20px 3px 0;font-weight:bold;font-size:16px;color:#2d5016">Total Paid</td>
                <td style="padding:10px 0 3px;font-weight:bold;font-size:18px;color:#2d5016;text-align:right">₹${Number(order.total).toLocaleString('en-IN')}</td>
              </tr>
            </table>
          </div>

          <!-- Delivery Address -->
          <div style="background:#f5f5f5;padding:15px 20px;border-radius:8px;margin:20px 0">
            <strong style="color:#2d5016">📍 Delivery Address</strong><br><br>
            ${order.ship_name}<br>
            ${order.ship_address1}${order.ship_address2 ? ', ' + order.ship_address2 : ''}<br>
            ${order.ship_city}, ${order.ship_state} — ${order.ship_pincode}<br>
            ${order.ship_country}
          </div>

          <!-- Cancellation Notice (only on confirmation) -->
          ${type === 'confirmation' ? `
          <div style="background:#fff3e0;padding:15px 20px;border-radius:8px;margin:20px 0;border-left:4px solid #ff9800">
            <strong>⏱ Cancellation Policy</strong><br>
            You can cancel this order within <strong>30 minutes</strong> of payment for an automatic refund.
            Visit <a href="${process.env.SITE_URL || 'https://antoncraftex.com'}/track" style="color:#2d5016">Track Order</a> to cancel.
          </div>` : ''}

          <p style="color:#888;font-size:13px">
            Need help? Reply to this email or contact us at ${process.env.ADMIN_EMAIL || 'admin@antoncraftex.com'}
          </p>
        </div>

        <!-- Footer -->
        <div style="background:#2d5016;padding:20px;text-align:center">
          <p style="color:#c8e6c9;margin:0;font-size:13px">Anton Craftex — Craft Park, Thethurai Village, Cheyyar Taluk, Tamil Nadu</p>
          <p style="color:#81c784;margin:8px 0 0;font-size:12px">Every purchase supports rural artisans and women empowerment 🌿</p>
        </div>

      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from:    `"Anton Craftex" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
    to:      order.guest_email,
    subject,
    html,
  });

  console.log(`[Email] ${type} email sent to ${order.guest_email}`);
}

// ── OTP EMAIL ──────────────────────────────────────────────
async function sendOTPEmail(email, otp) {
  if (!isEmailConfigured()) {
    // In dev mode — show OTP in terminal so you can test
    console.log(`\n[Email] OTP for ${email}: ${otp}  (SMTP not configured — showing in terminal)\n`);
    return;
  }

  await transporter.sendMail({
    from:    `"Anton Craftex" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
    to:      email,
    subject: '🔐 Your Anton Craftex Order History OTP',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:400px;margin:40px auto;text-align:center">
        <div style="background:#2d5016;padding:20px;border-radius:12px 12px 0 0">
          <h2 style="color:#fff;margin:0">Anton Craftex</h2>
        </div>
        <div style="background:#fff;padding:30px;border:1px solid #eee;border-radius:0 0 12px 12px">
          <p style="color:#555">Use this OTP to view your order history:</p>
          <div style="font-size:42px;font-weight:bold;color:#2d5016;padding:20px;background:#f0f7e6;border-radius:8px;letter-spacing:8px;margin:20px 0">
            ${otp}
          </div>
          <p style="color:#888;font-size:13px">⏱ Valid for <strong>10 minutes</strong>. Do not share this OTP with anyone.</p>
          <p style="color:#aaa;font-size:11px">If you didn't request this, ignore this email.</p>
        </div>
      </div>
    `,
  });

  console.log(`[Email] OTP sent to ${email}`);
}

module.exports = { sendOrderEmail, sendOTPEmail };
