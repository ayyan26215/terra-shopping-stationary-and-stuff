// Terra backend v3 - Express + Postgres + Stripe (CommonJS)
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(cors());
// We need raw body for webhook only; other routes use JSON
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// Auth middleware
function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admins only' });
  next();
}

// Signup
app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, is_admin',
      [username, email, hashed]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'User exists or invalid' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Public products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

// Admin product routes
app.post('/api/admin/products', authenticateToken, requireAdmin, async (req, res) => {
  const { title, description, price, image } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (title, description, price, image) VALUES ($1,$2,$3,$4) RETURNING *',
      [title, description, price, image]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Insert failed' });
  }
});

app.put('/api/admin/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, description, price, image } = req.body;
  try {
    const result = await pool.query(
      'UPDATE products SET title=$1, description=$2, price=$3, image=$4 WHERE id=$5 RETURNING *',
      [title, description, price, image, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/admin/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Cart routes (per-user)
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.product_id, c.quantity, p.title, p.price, p.image
       FROM cart c JOIN products p ON c.product_id = p.id
       WHERE c.user_id=$1`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Cart fetch failed' });
  }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
  const { product_id, quantity } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM cart WHERE user_id=$1 AND product_id=$2', [req.user.id, product_id]);
    if (existing.rows.length > 0) {
      await pool.query('UPDATE cart SET quantity = quantity + $1 WHERE user_id=$2 AND product_id=$3', [quantity, req.user.id, product_id]);
    } else {
      await pool.query('INSERT INTO cart (user_id, product_id, quantity) VALUES ($1,$2,$3)', [req.user.id, product_id, quantity]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Add to cart failed' });
  }
});

app.put('/api/cart/:product_id', authenticateToken, async (req, res) => {
  const { product_id } = req.params;
  const { quantity } = req.body;
  try {
    if (quantity <= 0) {
      await pool.query('DELETE FROM cart WHERE user_id=$1 AND product_id=$2', [req.user.id, product_id]);
    } else {
      await pool.query('UPDATE cart SET quantity=$1 WHERE user_id=$2 AND product_id=$3', [quantity, req.user.id, product_id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update cart failed' });
  }
});

app.delete('/api/cart/:product_id', authenticateToken, async (req, res) => {
  const { product_id } = req.params;
  try {
    await pool.query('DELETE FROM cart WHERE user_id=$1 AND product_id=$2', [req.user.id, product_id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Remove failed' });
  }
});

// Orders: create order, clear cart, start Stripe session
app.post('/api/checkout', authenticateToken, async (req, res) => {
  const { name, email, phone, address, landmark } = req.body;
  try {
    const cartRes = await pool.query(
      `SELECT c.product_id, c.quantity, p.title, p.price
       FROM cart c JOIN products p ON c.product_id = p.id
       WHERE c.user_id=$1`,
      [req.user.id]
    );
    if (cartRes.rows.length === 0) return res.status(400).json({ error: 'Cart empty' });

    const total = cartRes.rows.reduce((s, it) => s + it.quantity * parseFloat(it.price), 0);

    const orderRes = await pool.query(
      'INSERT INTO orders (user_id, name, email, phone, address, landmark, total, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.user.id, name, email, phone, address, landmark, total, 'pending']
    );
    const order = orderRes.rows[0];

    // insert order_items
    for (const it of cartRes.rows) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)',
        [order.id, it.product_id, it.quantity, it.price]
      );
    }

    // clear cart
    await pool.query('DELETE FROM cart WHERE user_id=$1', [req.user.id]);

    const line_items = cartRes.rows.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.title },
        unit_amount: Math.round(item.price * 100)
      },
      quantity: item.quantity
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: process.env.SUCCESS_URL || 'https://example.com/success',
      cancel_url: process.env.CANCEL_URL || 'https://example.com/cancel',
      metadata: { orderId: order.id.toString() }
    });

    res.json({ url: session.url, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// Admin: list orders
app.get('/api/admin/orders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.username
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );
    const orders = result.rows;
    for (const ord of orders) {
      const items = await pool.query('SELECT oi.*, p.title FROM order_items oi JOIN products p ON oi.product_id=p.id WHERE oi.order_id=$1', [ord.id]);
      ord.items = items.rows;
    }
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Orders fetch failed' });
  }
});

// Stripe webhook endpoint (must use raw body)
app.post('/api/webhook', bodyParser.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata.orderId;
    // update order status to paid
    pool.query('UPDATE orders SET status=$1 WHERE id=$2', ['paid', orderId])
      .then(() => console.log('Order marked paid:', orderId))
      .catch(err => console.error('Failed to update order status', err));
  }

  res.json({received: true});
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Terra backend running on http://localhost:${PORT}`));
