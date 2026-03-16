const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Commissioner password — change this to whatever you want!
const COMMISSIONER_PASSWORD = process.env.COMMISSIONER_PASSWORD || 'madness2026';

// Where we store the data file
const DATA_DIR = fs.existsSync('.data') ? '.data' : '.';
const DATA_FILE = path.join(DATA_DIR, 'tournament-data.json');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Default empty state
const DEFAULT_STATE = {
  playerNames: {},
  teams: {},
  results: {},
  ffResults: {},
  log: []
};

// Load state from file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading data:', err.message);
  }
  return { ...DEFAULT_STATE };
}

// Save state to file
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving data:', err.message);
    return false;
  }
}

// ===== API ROUTES =====

// GET the full tournament state (anyone can view)
app.get('/api/data', (req, res) => {
  const data = loadData();
  res.json(data);
});

// POST (save) the full tournament state (password required)
app.post('/api/data', (req, res) => {
  const password = req.headers['x-commissioner-password'];
  if (password !== COMMISSIONER_PASSWORD) {
    return res.status(403).json({ error: 'Wrong password. Only the commissioner can make changes.' });
  }
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid data' });
  }
  const success = saveData(data);
  if (success) {
    res.json({ status: 'ok' });
  } else {
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Verify password endpoint
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  if (password === COMMISSIONER_PASSWORD) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

// Fallback: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`March Madness Tracker running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
