const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & middleware
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.redirect('/login');
}

// --- Auth routes ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const pass = String(req.body.password || '');
  const expected = String(process.env.APP_PASSWORD || '');
  if (expected && pass === expected) {
    req.session.authed = true;
    return res.redirect('/');
  }
  return res.status(401).send(`
    <html><body style="font-family:system-ui;background:#0b1220;color:#e9eef7;">
    <div style="max-width:420px;margin:5rem auto;background:#132235;padding:20px;border-radius:12px;">
      <h3>Login failed</h3>
      <p>Wrong password. <a style="color:#8db6ff" href="/login">Try again</a>.</p>
    </div></body></html>
  `);
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Plaid setup (Transactions + Investments by default) ---
const plaidEnv = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
const plaidProducts = (process.env.PLAID_PRODUCTS || 'transactions,investments')
  .split(',').map(s => s.trim()).filter(Boolean);

const plaidCfg = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || '',
      'PLAID-SECRET': process.env.PLAID_SECRET || ''
    }
  }
});
const plaid = new PlaidApi(plaidCfg);

// Demo in-memory token (single user). For real use, store securely.
let ACCESS_TOKEN = null;

// Status
app.get('/api/status', requireAuth, (req, res) => {
  res.json({ plaid: { env: plaidEnv, products: plaidProducts, linked: !!ACCESS_TOKEN } });
});

// Create Link token
app.post('/plaid/create_link_token', requireAuth, async (req, res) => {
  try {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return res.status(501).json({ error: 'Plaid not configured. Add PLAID_CLIENT_ID and PLAID_SECRET in Render.' });
    }
    const resp = await plaid.linkTokenCreate({
      user: { client_user_id: 'moneyhub-user' },
      client_name: 'My Money Hub',
      products: plaidProducts,
      country_codes: ['US'],
      language: 'en'
    });
    res.json({ link_token: resp.data.link_token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'link_token failed' });
  }
});

// Exchange public token
app.post('/plaid/exchange_public_token', requireAuth, async (req, res) => {
  try {
    const { public_token } = req.body || {};
    if (!public_token) return res.status(400).json({ error: 'Missing public_token' });
    const resp = await plaid.itemPublicTokenExchange({ public_token });
    ACCESS_TOKEN = resp.data.access_token;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'exchange failed' });
  }
});

// Pull transactions (last 30 days)
app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    if (!ACCESS_TOKEN) return res.status(400).json({ error: 'No bank linked yet.' });
    const end = new Date();
    const start = new Date(); start.setDate(end.getDate() - 30);
    const iso = d => d.toISOString().slice(0,10);

    const txResp = await plaid.transactionsGet({
      access_token: ACCESS_TOKEN,
      start_date: iso(start),
      end_date: iso(end),
      options: { count: 250, offset: 0 }
    });

    const txs = txResp.data.transactions.map(t => ({
      id: t.transaction_id,
      date: t.date,
      name: t.name,
      amount: t.amount, // Plaid: >0 outflow, <0 inflow
      account_id: t.account_id,
      category: (t.personal_finance_category?.primary || t.category?.[0] || 'Other')
    }));

    res.json({ transactions: txs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'transactions fetch failed' });
  }
});

// --- Protected static site ---
app.use('/', requireAuth, express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  extensions: ['html']
}));

// Fallback
app.use((req, res) => res.redirect('/'));

// Start
app.listen(PORT, () => {
  console.log(`MoneyHub private server running on :${PORT}`);
});
