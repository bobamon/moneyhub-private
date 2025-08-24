const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false // keep simple so inline scripts/CSS work
}));
app.use(compression());
app.use(express.urlencoded({ extended: true }));

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

// --- Protected static site ---
app.use('/', requireAuth, express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  extensions: ['html']
}));

// No-route fallback
app.use((req, res) => res.redirect('/'));

// Start
app.listen(PORT, () => {
  console.log(`MoneyHub private server running on :${PORT}`);
});
