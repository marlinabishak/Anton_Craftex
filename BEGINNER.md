# Beginner Guide

## What this project is
Anton Craftex is a Node.js + Express ecommerce site with a browser UI in `public/`.

## Requirements
- Node.js 18+
- MySQL running
- `.env` file set up

## Install
```bash
npm install
```

## Database setup
Run the DB setup script if needed:
```bash
npm run setup
```

## Start development server
```bash
npm run dev
```

## Start production server
```bash
npm start
```

## Optional PM2 production run
```bash
npm run pm2
```

## Important files
- `server.js` - main server
- `public/index.html` - UI
- `public/app.js` - frontend logic
- `public/style.css` - styles
- `src/routes/` - API routes
- `src/config/db.js` - database config

## Key routes
- `DELETE /api/cart/remove/:product_id` - remove cart item
- `POST /api/cart/remove` - compatibility alias for older frontend code
- `POST /api/cart/add` - add or increase cart item
- `POST /api/cart/coupon` - apply coupon
- `GET /api/orders/track` - track order by email and order number

## Open in browser
- `http://localhost:3000`

## Common issues
- If UI does not load, check `public/app.js` and browser console.
- If APIs fail, check MySQL connection and `.env`.
- If Razorpay checkout fails, verify the payment keys in `.env`.
- If cart remove does not work, verify the `/api/cart/remove/:product_id` route and refresh the page.
