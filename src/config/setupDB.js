/**
 * ANTON CRAFTEX - DATABASE SETUP SCRIPT
 * ============================================================
 * Run ONCE before first launch:
 *   node src/config/setupDB.js
 *
 * This creates:
 *  - All tables (users, products, orders, cart, etc.)
 *  - 11 product categories (PatchMagic + Divine Foods)
 *  - 22 sample products
 *  - Admin user (email: admin@antoncraftex.com, pass: Anton@Admin2024)
 *  - Sample coupon CRAFTEX10 (10% off ₹500+)
 *
 * SAFE to run multiple times (uses IF NOT EXISTS + INSERT IGNORE)
 * ============================================================
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

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

async function setupDatabase() {
  let connection;
  try {
    // Connect WITHOUT selecting a database (we'll create it)
    connection = await mysql.createConnection({
      host:               process.env.DB_HOST || 'localhost',
      port:               parseInt(process.env.DB_PORT) || 3306,
      user:               process.env.DB_USER || 'root',
      password:           process.env.DB_PASS || '',
      multipleStatements: true,
      charset:            'utf8mb4'
    });

    console.log('\n✅ Connected to MySQL server');

    const DB = process.env.DB_NAME || 'anton_craftex';

    // ── CREATE DATABASE ────────────────────────────────────
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await connection.query(`USE \`${DB}\`;`);
    console.log(`✅ Database '${DB}' ready`);

    // ── USERS TABLE ────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        uuid          VARCHAR(36)  UNIQUE NOT NULL,
        name          VARCHAR(100) NOT NULL,
        email         VARCHAR(150) UNIQUE NOT NULL,
        phone         VARCHAR(20),
        password_hash VARCHAR(255),
        is_guest      TINYINT(1)   DEFAULT 1,
        is_admin      TINYINT(1)   DEFAULT 0,
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city          VARCHAR(100),
        state         VARCHAR(100),
        pincode       VARCHAR(10),
        country       VARCHAR(50)  DEFAULT 'India',
        otp_code      VARCHAR(6),
        otp_expires_at DATETIME,
        created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_uuid  (uuid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: users');

    // ── CATEGORIES TABLE ───────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        slug        VARCHAR(100) UNIQUE NOT NULL,
        brand       ENUM('patchmagic','divine_foods','craftex') NOT NULL,
        description TEXT,
        image_url   VARCHAR(255),
        sort_order  INT          DEFAULT 0,
        is_active   TINYINT(1)   DEFAULT 1,
        created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: categories');

    // ── PRODUCTS TABLE ─────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        uuid              VARCHAR(36)   UNIQUE NOT NULL,
        category_id       INT           NOT NULL,
        name              VARCHAR(200)  NOT NULL,
        slug              VARCHAR(200)  UNIQUE NOT NULL,
        brand             ENUM('patchmagic','divine_foods') NOT NULL,
        short_description VARCHAR(500),
        description       TEXT,
        price             DECIMAL(10,2) NOT NULL,
        price_min         DECIMAL(10,2),
        price_max         DECIMAL(10,2),
        mrp               DECIMAL(10,2),
        stock_qty         INT           DEFAULT 0,
        sku               VARCHAR(100),
        weight_grams      INT,
        dimensions        VARCHAR(100),
        material          VARCHAR(200),
        origin            VARCHAR(100),
        artisan_story     TEXT,
        images            TEXT,
        is_featured       TINYINT(1)    DEFAULT 0,
        is_active         TINYINT(1)    DEFAULT 1,
        is_customizable   TINYINT(1)    DEFAULT 0,
        tags              VARCHAR(500),
        created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        INDEX idx_brand    (brand),
        INDEX idx_slug     (slug),
        INDEX idx_featured (is_featured),
        FULLTEXT INDEX ft_search (name, short_description, tags)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      ALTER TABLE products MODIFY images TEXT
    `).catch(() => {});

    const [rows] = await connection.query('SELECT id, images FROM products');
    for (const row of rows) {
      const normalized = normalizeImages(row.images).map((img) => {
        const value = String(img).trim();
        if (!value) return '';
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) return value;
        return `/uploads/${value}`;
      }).filter(Boolean);
      await connection.query('UPDATE products SET images = ? WHERE id = ?', [JSON.stringify(normalized), row.id]);
    }
    console.log('✅ Table: products');

    // ── CART TABLE ─────────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS cart (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        session_id         VARCHAR(128) NOT NULL,
        user_id            INT,
        product_id         INT          NOT NULL,
        quantity           INT          DEFAULT 1,
        customization_note TEXT,
        added_at           DATETIME     DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE KEY unique_cart_item (session_id, product_id),
        INDEX idx_session  (session_id),
        INDEX idx_user_cart(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: cart');

    // ── ORDERS TABLE ───────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id                   INT AUTO_INCREMENT PRIMARY KEY,
        order_number         VARCHAR(20) UNIQUE NOT NULL,
        user_id              INT,
        guest_email          VARCHAR(150),
        guest_name           VARCHAR(100),
        guest_phone          VARCHAR(20),
        ship_name            VARCHAR(100) NOT NULL,
        ship_phone           VARCHAR(20),
        ship_address1        VARCHAR(255) NOT NULL,
        ship_address2        VARCHAR(255),
        ship_city            VARCHAR(100) NOT NULL,
        ship_state           VARCHAR(100) NOT NULL,
        ship_pincode         VARCHAR(10)  NOT NULL,
        ship_country         VARCHAR(50)  DEFAULT 'India',
        subtotal             DECIMAL(10,2) NOT NULL,
        shipping_charge      DECIMAL(10,2) DEFAULT 0.00,
        discount             DECIMAL(10,2) DEFAULT 0.00,
        total                DECIMAL(10,2) NOT NULL,
        status               ENUM('pending','paid','processing','shipped','delivered','cancelled','refund_requested','refunded') DEFAULT 'pending',
        payment_method       VARCHAR(50)  DEFAULT 'razorpay',
        razorpay_order_id    VARCHAR(100),
        razorpay_payment_id  VARCHAR(100),
        razorpay_signature   VARCHAR(255),
        payment_status       ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
        paid_at              DATETIME,
        refund_eligible_until DATETIME,
        refund_amount        DECIMAL(10,2),
        refund_id            VARCHAR(100),
        refunded_at          DATETIME,
        tracking_number      VARCHAR(100),
        courier_name         VARCHAR(100),
        shipped_at           DATETIME,
        delivered_at         DATETIME,
        customer_note        TEXT,
        admin_note           TEXT,
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_order_number    (order_number),
        INDEX idx_status          (status),
        INDEX idx_guest_email     (guest_email),
        INDEX idx_razorpay_order  (razorpay_order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: orders');

    // ── ORDER ITEMS TABLE ──────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        order_id           INT           NOT NULL,
        product_id         INT,
        product_name       VARCHAR(200)  NOT NULL,
        product_sku        VARCHAR(100),
        brand              VARCHAR(50),
        quantity           INT           NOT NULL,
        unit_price         DECIMAL(10,2) NOT NULL,
        total_price        DECIMAL(10,2) NOT NULL,
        customization_note TEXT,
        FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: order_items');

    // ── ORDER STATUS HISTORY ───────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_status_history (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        order_id    INT         NOT NULL,
        old_status  VARCHAR(50),
        new_status  VARCHAR(50) NOT NULL,
        note        TEXT,
        changed_by  VARCHAR(100) DEFAULT 'system',
        changed_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: order_status_history');

    // ── REVIEWS TABLE ──────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        product_id  INT        NOT NULL,
        user_id     INT,
        guest_name  VARCHAR(100),
        rating      TINYINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
        title       VARCHAR(200),
        body        TEXT,
        is_approved TINYINT(1) DEFAULT 0,
        created_at  DATETIME   DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: reviews');

    // ── CRAFT PARK ENQUIRIES ───────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS craft_park_enquiries (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        name           VARCHAR(100) NOT NULL,
        email          VARCHAR(150) NOT NULL,
        phone          VARCHAR(20),
        interest       ENUM('workshop','eco_tour','corporate_gifting','bulk_order','volunteering','other') NOT NULL,
        message        TEXT,
        preferred_date DATE,
        group_size     INT,
        status         ENUM('new','contacted','confirmed','closed') DEFAULT 'new',
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: craft_park_enquiries');

    // ── NEWSLETTER TABLE ───────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS newsletter (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(150) UNIQUE NOT NULL,
        name          VARCHAR(100),
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active     TINYINT(1) DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: newsletter');

    // ── COUPONS TABLE ──────────────────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        code       VARCHAR(50)   UNIQUE NOT NULL,
        type       ENUM('percent','fixed') DEFAULT 'percent',
        value      DECIMAL(10,2) NOT NULL,
        min_order  DECIMAL(10,2) DEFAULT 0,
        max_uses   INT           DEFAULT 100,
        used_count INT           DEFAULT 0,
        expires_at DATETIME,
        is_active  TINYINT(1)    DEFAULT 1,
        created_at DATETIME      DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table: coupons');

    // ── SEED: CATEGORIES ───────────────────────────────────
    await connection.query(`
      INSERT IGNORE INTO categories (name, slug, brand, description, sort_order) VALUES
      ('Quilts & Textiles',      'quilts-textiles',   'patchmagic',   'Handcrafted quilts made by rural women artisans', 1),
      ('Hand-Tufted Wool Rugs',  'wool-rugs',         'patchmagic',   'Revival of Panipat-style craft with Vandavasi artisans', 2),
      ('Jute & Korai Mats',      'jute-korai-mats',   'patchmagic',   'Eco-friendly floor coverings from local co-ops', 3),
      ('Clay Art & Décor',       'clay-art-decor',    'patchmagic',   'Handmade by local potters within 25km of Thethurai', 4),
      ('Memory Crafts',          'memory-crafts',     'patchmagic',   'Personalized keepsakes honoring loved ones', 5),
      ('Vegetable Atta & Grains','vegetable-atta',    'divine_foods', 'Nutritious vegetable-enriched flours', 6),
      ('Wellness Drinks',        'wellness-drinks',   'divine_foods', 'Karupatti coffee, Amla mix and immunity boosters', 7),
      ('Detox & Health Mixes',   'detox-health',      'divine_foods', 'Banana stem, ash gourd and traditional detox blends', 8),
      ('Pure Honey & Sweeteners','honey-sweeteners',  'divine_foods', 'Raw unprocessed honey from Kolli Hills', 9),
      ('Millet Products',        'millet-products',   'divine_foods', 'V3 millet range for sustainable nutrition', 10),
      ('Pickles & Condiments',   'pickles-condiments','divine_foods', 'Olive oil pickles and traditional condiments', 11);
    `);
    console.log('✅ Seeded: categories (11)');

    // ── SEED: PRODUCTS ─────────────────────────────────────
    await connection.query(`
      INSERT IGNORE INTO products
        (uuid, category_id, name, slug, brand, short_description, price, mrp, stock_qty, sku, origin, is_featured, is_customizable, tags, images)
      VALUES
        (UUID(),1,'Baby Quilt - Floral Garden','baby-quilt-floral-garden','patchmagic','Soft eco-wash baby quilt with vibrant floral patterns',1050,1400,50,'PM-BQ-001','Thethurai Village, TN',1,0,'baby,quilt,cotton,floral,gift','[]'),
        (UUID(),1,'Cradle Set - Heritage Collection','cradle-set-heritage','patchmagic','Complete cradle set with quilt, pillow and cushions',1850,2500,30,'PM-CS-001','Thethurai Village, TN',1,0,'cradle,baby,heritage,gift,newborn','[]'),
        (UUID(),1,'Bed Spread - Patchwork Mandala','bedspread-patchwork-mandala','patchmagic','Queen size patchwork bedspread with mandala design',3500,4500,20,'PM-BS-001','Thethurai Village, TN',1,0,'bedspread,mandala,patchwork,queen,bedroom','[]'),
        (UUID(),1,'Cushion Cover Set (5 pcs)','cushion-cover-set-5','patchmagic','Set of 5 handcrafted patchwork cushion covers',300,450,100,'PM-CC-001','Thethurai Village, TN',0,0,'cushion,cover,patchwork,set,home-decor','[]'),
        (UUID(),2,'Hand-Tufted Wool Rug Animal (2x3ft)','wool-rug-animal-2x3','patchmagic','Adorable animal-shaped hand-tufted wool rug for kids',1200,2000,40,'PM-WR-001','Vandavasi, TN',1,0,'wool,rug,kids,animal,tufted','[]'),
        (UUID(),2,'Hand-Tufted Mandala Rug (3x5ft)','wool-rug-mandala-3x5','patchmagic','Stunning mandala design hand-tufted wool rug',2200,3500,25,'PM-WR-002','Vandavasi, TN',1,0,'wool,rug,mandala,living-room,premium','[]'),
        (UUID(),3,'Jute Rug - Natural Weave','jute-rug-natural','patchmagic','Eco-friendly natural jute rug for sustainable homes',850,1100,60,'PM-JR-001','Tamil Nadu',0,0,'jute,rug,eco,natural,sustainable','[]'),
        (UUID(),3,'Korai Mat - Vandavasi Specialty','korai-mat-vandavasi','patchmagic','Traditional korai grass mat from Vandavasi artisans',450,600,100,'PM-KM-001','Vandavasi, TN',0,0,'korai,mat,yoga,meditation,natural','[]'),
        (UUID(),4,'Clay Pot Set - Traditional','clay-pot-set-traditional','patchmagic','Set of 3 handcrafted clay pots for home décor',650,900,45,'PM-CP-001','Local Potters, TN',0,0,'clay,pot,decor,traditional,handmade','[]'),
        (UUID(),5,'Memory Quilt - Personal Clothing','memory-quilt-personal','patchmagic','Custom quilt made from your loved ones clothing',3500,4000,20,'PM-MQ-001','Thethurai Village, TN',1,1,'memory,quilt,custom,personalized,gift,tribute','[]'),
        (UUID(),5,'Memory Bear - Keepsake Soft Toy','memory-bear-keepsake','patchmagic','Soft bear made from loved ones clothes',1200,1500,30,'PM-MB-001','Thethurai Village, TN',0,1,'memory,bear,custom,grief,keepsake,personalized','[]'),
        (UUID(),6,'Beetroot Vegetable Atta (1kg)','beetroot-atta-1kg','divine_foods','Iron-rich beetroot enriched wheat flour',160,200,200,'DF-BA-001','Kolli Hills, TN',1,0,'beetroot,atta,flour,healthy,iron','[]'),
        (UUID(),6,'Spinach Vegetable Atta (1kg)','spinach-atta-1kg','divine_foods','Protein-rich spinach wheat flour',160,200,150,'DF-SA-001','Kolli Hills, TN',0,0,'spinach,atta,flour,healthy,green','[]'),
        (UUID(),6,'Carrot Vegetable Atta (1kg)','carrot-atta-1kg','divine_foods','Vitamin-A rich carrot wheat flour',160,200,150,'DF-CA-001','Kolli Hills, TN',0,0,'carrot,atta,flour,healthy,kids','[]'),
        (UUID(),7,'Instant Karupatti Coffee (200g)','karupatti-coffee-200g','divine_foods','Traditional palm jaggery coffee, no refined sugar',165,220,300,'DF-KC-001','Tamil Nadu',1,0,'karupatti,coffee,jaggery,healthy,instant,sugar-free','[]'),
        (UUID(),7,'Amla Immunity Mix (250g)','amla-immunity-mix-250g','divine_foods','Traditional Indian gooseberry immunity booster',120,160,200,'DF-AI-001','Kolli Hills, TN',1,0,'amla,immunity,gooseberry,ayurveda,healthy','[]'),
        (UUID(),7,'Palmyra Sprout Powder (250g)','palmyra-sprout-powder-250g','divine_foods','Rare palmyra sprout powder for natural energy',140,200,120,'DF-PS-001','Tamil Nadu',0,0,'palmyra,sprout,energy,traditional,rare','[]'),
        (UUID(),8,'Banana Stem Soup Mix (200g)','banana-stem-soup-200g','divine_foods','Fibre-rich banana stem soup for gut health',110,160,180,'DF-BS-001','Kolli Hills, TN',0,0,'banana,stem,soup,fibre,gut-health','[]'),
        (UUID(),8,'Ash Gourd Detox Mix (200g)','ash-gourd-detox-200g','divine_foods','Traditional ash gourd detox for weight management',110,160,180,'DF-AG-001','Tamil Nadu',0,0,'ash-gourd,detox,weight,ayurveda,cleanse','[]'),
        (UUID(),9,'Pure Raw Honey - Kolli Hills (250ml)','raw-honey-kolli-hills-250ml','divine_foods','Unprocessed wild forest honey from Kolli Hills',240,320,100,'DF-RH-001','Kolli Hills, TN',1,0,'honey,raw,forest,kolli-hills,organic,pure','[]'),
        (UUID(),10,'V3 Millet Mix (500g)','v3-millet-mix-500g','divine_foods','Three-millet power blend for complete nutrition',175,240,250,'DF-MM-001','Tamil Nadu',1,0,'millet,v3,nutrition,diabetic,healthy,grain','[]'),
        (UUID(),11,'Olive Oil Pickle - Mixed Veg (300g)','olive-oil-pickle-300g','divine_foods','Traditional Indian pickle in healthy olive oil',210,280,150,'DF-OP-001','Tamil Nadu',0,0,'pickle,olive-oil,traditional,preservative-free,condiment','[]');
    `);
    console.log('✅ Seeded: products (22)');

    // ── SEED: ADMIN USER ───────────────────────────────────
    const adminPass = process.env.ADMIN_PASSWORD || 'Anton@Admin2024';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@antoncraftex.com';
    const hash = await bcrypt.hash(adminPass, 10);

    const { v4: uuidv4 } = require('uuid');
    await connection.query(`
      INSERT IGNORE INTO users (uuid, name, email, phone, password_hash, is_guest, is_admin)
      VALUES (?, 'Admin', ?, '9999999999', ?, 0, 1)
    `, [uuidv4(), adminEmail, hash]);
    console.log(`✅ Admin user: ${adminEmail} / ${adminPass}`);

    // ── SEED: SAMPLE COUPON ────────────────────────────────
    await connection.query(`
      INSERT IGNORE INTO coupons (code, type, value, min_order, max_uses, expires_at)
      VALUES ('CRAFTEX10', 'percent', 10, 500, 500, DATE_ADD(NOW(), INTERVAL 1 YEAR));
    `);
    console.log('✅ Seeded: coupon CRAFTEX10 (10% off ₹500+)');

    console.log('\n🎉 Database setup COMPLETE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Next step: npm start');
    console.log('  Admin URL: http://localhost:3000/admin');
    console.log(`  Admin:     ${adminEmail}`);
    console.log(`  Password:  ${adminPass}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('\n❌ Database setup FAILED:', err.message);
    console.error('   → Check your .env file has correct DB_HOST, DB_USER, DB_PASS');
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

setupDatabase();
