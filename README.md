# Anton Craftex

Anton Craftex is a production-style ecommerce platform for two core brands: PatchMagic and Divine Foods. It also includes Craft Park, guest order tracking, user accounts, cart/checkout, Razorpay payment flow, admin tools, and email/OTP support.

## What We Built

- Modern home page with branded sections
- Dedicated brand pages for PatchMagic and Divine Foods
- Mobile-first navigation and improved spacing
- Live product catalog, filtering, search, and sorting
- Real-time cart add, remove, quantity update, and clear cart
- Checkout and Razorpay payment flow
- Guest order tracking and OTP-based order history
- Craft Park enquiry form
- Admin dashboard, product management, order management, and refund support

## Project Workflow

1. User opens the home page and sees the brand story, featured products, and craft park promotion.
2. User can enter PatchMagic or Divine Foods pages for brand-specific browsing.
3. User searches, filters, and opens a product detail page.
4. User adds items to the cart and the totals update immediately.
5. User proceeds to checkout, fills delivery details, and pays through Razorpay.
6. Backend creates the order, stores items, verifies payment, clears the cart, and sends confirmation email.
7. User can track the order later with order number + email or use OTP to view order history.
8. Admin can view orders, manage products, approve reviews, and process refunds.

## Tech Stack

- Node.js + Express
- MySQL
- Session-based cart storage
- Razorpay payments
- Nodemailer for OTP and order emails
- PM2 for production process management

## Main Files

- `server.js` - app entry point and route wiring
- `public/index.html` - frontend pages and layout
- `public/app.js` - client-side UI and API flow
- `public/style.css` - full site styling
- `src/config/db.js` - MySQL pool
- `src/config/setupDB.js` - database creation and seeding
- `src/routes/products.js` - product catalog endpoints
- `src/routes/cart.js` - cart endpoints
- `src/routes/payment.js` - Razorpay order/payment endpoints
- `src/routes/orders.js` - tracking and order history endpoints
- `src/routes/users.js` - auth and newsletter endpoints
- `src/routes/admin.js` - admin endpoints
- `src/routes/craftpark.js` - Craft Park enquiry endpoint
- `src/middleware/email.js` - email/OTP helpers

## Setup

```bash
npm install
npm run setup
```

Before running setup, make sure MySQL is running and `.env` is filled in.

## Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Production Run

```bash
npm start
```

## PM2

```bash
npm install -g pm2
npm run pm2
pm2 save
pm2 startup
```

## Environment Variables

Copy your `.env` and fill these values:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`
- `SESSION_SECRET`
- `SITE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `FROM_EMAIL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `REFUND_WINDOW_MINUTES` optional
- `ENABLE_CLUSTERING` optional

## Customer Flow

1. Browse the home page or brand pages.
2. Search and filter products.
3. Open product details.
4. Add items to cart.
5. Update quantity or remove items in real time.
6. Checkout and pay.
7. Receive confirmation email.
8. Track the order later using order number and email.

## Admin Flow

1. Log in as admin.
2. View dashboard stats.
3. Manage products and stock.
4. View users, orders, and craft park enquiries.
5. Approve reviews.
6. Process refunds and status updates.

## Notes

- Cart is stored on the server using session ID.
- Orders are written to MySQL before payment verification.
- Payment verification clears the cart after success.
- Mobile layout and spacing were polished for cleaner ecommerce UI.
- Brand pages now follow the same visual language as the home page.

## Health Check

```text
/health
```

Returns server status, uptime, memory, and PID.
