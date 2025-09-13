const API_URL = (typeof API_URL_GLOBAL !== 'undefined') ? API_URL_GLOBAL : 'http://localhost:5000/api';

// UI helpers
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

// load products
async function loadProducts() {
  const res = await fetch(`${API_URL}/products`);
  const products = await res.json();
  const list = document.getElementById('product-list');
  list.innerHTML = products.map(p => `
    <div class="card">
      <img src="${p.image}" alt="${p.title}">
      <h3>${p.title}</h3>
      <p>${p.description || ''}</p>
      <p class="price">$${p.price}</p>
      <button onclick="addToCart(${p.id})">Add to cart</button>
    </div>
  `).join('');
}

// cart functions (requires auth)
function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function updateCartCount() {
  try {
    const res = await fetch(`${API_URL}/cart`, { headers: authHeaders() });
    if (!res.ok) { document.getElementById('cart-count').innerText = '0'; return; }
    const cart = await res.json();
    const count = cart.reduce((s,i) => s + i.quantity, 0);
    document.getElementById('cart-count').innerText = count;
  } catch (err) {
    console.error(err);
  }
}

async function addToCart(product_id) {
  try {
    await fetch(`${API_URL}/cart`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ product_id, quantity: 1 }) });
    await updateCartCount();
    alert('Added to cart');
  } catch (err) { console.error(err); alert('Add failed'); }
}

async function loadCart() {
  const res = await fetch(`${API_URL}/cart`, { headers: authHeaders() });
  if (!res.ok) { document.getElementById('cart-items').innerHTML = '<p>Login to view cart</p>'; return; }
  const cart = await res.json();
  document.getElementById('cart-items').innerHTML = cart.map(i => \`
    <div class="cart-row">
      <img src="\${i.image}" alt="\${i.title}">
      <div>
        <h4>\${i.title}</h4>
        <p>\$ \${i.price} × \${i.quantity}</p>
        <div class="cart-qty">
          <button onclick="updateQuantity(\${i.product_id}, \${i.quantity - 1})">-</button>
          <span>\${i.quantity}</span>
          <button onclick="updateQuantity(\${i.product_id}, \${i.quantity + 1})">+</button>
          <button onclick="removeFromCart(\${i.product_id})">Remove</button>
        </div>
      </div>
    </div>
  \`).join('');
  renderCartSummary(cart);
  updateCartCount();
}

function renderCartSummary(cart) {
  const summary = document.getElementById('cart-summary');
  if (!cart || cart.length === 0) { summary.innerHTML = ''; return; }
  const total = cart.reduce((s,i) => s + i.price * i.quantity, 0);
  summary.innerHTML = \`
    <h3>Total: $\${total.toFixed(2)}</h3>
    <button onclick="showCheckoutForm()">Proceed to Checkout</button>
  \`;
}

async function updateQuantity(product_id, quantity) {
  try {
    await fetch(`${API_URL}/cart/${product_id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ quantity }) });
    loadCart();
  } catch (err) { console.error(err); }
}

async function removeFromCart(product_id) {
  try {
    await fetch(`${API_URL}/cart/${product_id}`, { method: 'DELETE', headers: authHeaders() });
    loadCart();
  } catch (err) { console.error(err); }
}

// Checkout flow
function showCheckoutForm() {
  const container = document.getElementById('checkout-form-container');
  container.innerHTML = \`
    <h3>Checkout Details</h3>
    <input id="c-name" placeholder="Full name" required><br>
    <input id="c-email" placeholder="Email" required><br>
    <input id="c-phone" placeholder="Phone"><br>
    <input id="c-address" placeholder="Address" required><br>
    <input id="c-landmark" placeholder="Landmark (optional)"><br>
    <button onclick="submitCheckout()">Pay & Place Order</button>
  \`;
  container.scrollIntoView({ behavior: 'smooth' });
}

async function submitCheckout() {
  const payload = {
    name: document.getElementById('c-name').value,
    email: document.getElementById('c-email').value,
    phone: document.getElementById('c-phone').value,
    address: document.getElementById('c-address').value,
    landmark: document.getElementById('c-landmark').value
  };
  try {
    const res = await fetch(`${API_URL}/checkout`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else alert('Checkout failed');
  } catch (err) { console.error(err); alert('Checkout error'); }
}

// admin UI
document.getElementById('admin-toggle').addEventListener('click', () => {
  const admin = document.getElementById('admin');
  admin.style.display = admin.style.display === 'none' ? 'block' : 'none';
  if (admin.style.display === 'block') {
    loadAdminProducts();
    loadAdminOrders();
  }
});

async function loadAdminProducts() {
  const res = await fetch(`${API_URL}/products`);
  const products = await res.json();
  const list = document.getElementById('admin-product-list');
  list.innerHTML = products.map(p => \`
    <div class="card">
      <h3>\${p.title}</h3>
      <p>$\${p.price}</p>
      <button onclick="adminDelete(\${p.id})">Delete</button>
      <button onclick="adminEdit(\${p.id}, '\${p.title.replace(/'/g, "\\'")}', '\${(p.description||'').replace(/'/g, "\\'")}', \${p.price}, '\${p.image}')">Edit</button>
    </div>
  \`).join('');
}

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('admin-title').value;
  const description = document.getElementById('admin-desc').value;
  const price = parseFloat(document.getElementById('admin-price').value);
  const image = document.getElementById('admin-image').value;
  try {
    await fetch(`${API_URL}/admin/products`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, description, price, image })
    });
    loadAdminProducts();
  } catch (err) { console.error(err); alert('Add failed'); }
});

async function adminDelete(id) {
  if (!confirm('Delete?')) return;
  await fetch(`${API_URL}/admin/products/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadAdminProducts();
}

async function adminEdit(id, title, desc, price, image) {
  const newTitle = prompt('Title', title);
  if (!newTitle) return;
  const newDesc = prompt('Description', desc);
  const newPrice = prompt('Price', price);
  const newImage = prompt('Image URL', image);
  await fetch(`${API_URL}/admin/products/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ title: newTitle, description: newDesc, price: parseFloat(newPrice), image: newImage })
  });
  loadAdminProducts();
}

async function loadAdminOrders() {
  try {
    const res = await fetch(`${API_URL}/admin/orders`, { headers: authHeaders() });
    if (!res.ok) { document.getElementById('admin-order-list').innerHTML = '<p>Login as admin to view orders</p>'; return; }
    const orders = await res.json();
    const el = document.getElementById('admin-order-list');
    el.innerHTML = orders.map(o => \`
      <div class="order-card">
        <strong>Order #\${o.id}</strong> - \${o.name} (\${o.email}) - $ \${o.total} - \${o.status} - \${new Date(o.created_at).toLocaleString()}
        <div>
          \${o.items.map(it => '<div>' + it.title + ' × ' + it.quantity + ' ($' + it.price + ')</div>').join('')}
        </div>
      </div>
    \`).join('');
  } catch (err) { console.error(err); }
}

// initial load
showSection('products');
loadProducts();
updateCartCount();
