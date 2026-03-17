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

// ===== HARDCODED BRACKET, DRAFT & PLAYER NAMES =====
// These are the canonical starting state — always applied on top of saved data
const PLAYER_NAMES = {A:'Adam',B:'Brock',C:'Chase',D:'Colin',E:'Dalton',F:'Eric',G:'Max',H:'Nick',I:'Zach'};

const DEFAULT_BRACKET = {
  0:{1:'Florida',2:'Houston',3:'Illinois',4:'Nebraska',5:'Vanderbilt',6:'North Carolina',7:'Saint Marys',8:'Clemson',9:'Iowa',10:'Texas A&M',11:'VCU',12:'McNeese',13:'Troy',14:'Penn',15:'Idaho',16:'PV A&M/Lehigh'},
  1:{1:'Duke',2:'UConn',3:'Michigan St',4:'Kansas',5:'St. Johns',6:'Louisville',7:'UCLA',8:'Ohio St',9:'TCU',10:'UCF',11:'South Florida',12:'Northern Iowa',13:'Cal Baptist',14:'North Dakota St',15:'Furman',16:'Siena'},
  2:{1:'Michigan',2:'Iowa St',3:'Virginia',4:'Alabama',5:'Texas Tech',6:'Tennessee',7:'Kentucky',8:'Georgia',9:'Saint Louis',10:'Santa Clara',11:'Miami OH/SMU',12:'Akron',13:'Hofstra',14:'Wright St',15:'Tennessee St',16:'UMBC/Howard'},
  3:{1:'Arizona',2:'Purdue',3:'Gonzaga',4:'Arkansas',5:'Wisconsin',6:'BYU',7:'Miami',8:'Villanova',9:'Utah St',10:'Missouri',11:'Texas/NC State',12:'High Point',13:'Hawaii',14:'Kennesaw St',15:'Queens',16:'LIU'}
};

const DRAFT_ASSIGNMENTS = {
  0:{1:'D',2:'C',3:'I',4:'D',5:'E',6:'C',7:'G',8:'I',9:'C',10:'I',11:'G',12:'E',13:'H',14:'D',15:'H',16:'C'},
  1:{1:'E',2:'H',3:'F',4:'C',5:'A',6:'G',7:'I',8:'I',9:'B',10:'D',11:'H',12:'A',13:'B',14:'F',15:'D',16:''},
  2:{1:'E',2:'D',3:'H',4:'F',5:'G',6:'B',7:'B',8:'A',9:'B',10:'F',11:'C',12:'B',13:'H',14:'G',15:'E',16:'I'},
  3:{1:'D',2:'A',3:'E',4:'H',5:'A',6:'F',7:'F',8:'E',9:'I',10:'A',11:'G',12:'C',13:'B',14:'G',15:'F',16:'A'}
};

// Build the canonical teams state from bracket + draft
function buildCanonicalTeams() {
  const teams = {};
  for (let ri = 0; ri < 4; ri++) {
    teams[ri] = {};
    for (let s = 1; s <= 16; s++) {
      teams[ri][s] = { name: DEFAULT_BRACKET[ri][s], owner: DRAFT_ASSIGNMENTS[ri][s] || '' };
    }
  }
  return teams;
}

// Load state from file, always ensuring bracket/draft/names are correct
function loadData() {
  let data = { playerNames: {}, teams: {}, results: {}, ffResults: {}, log: [] };
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      data = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading data:', err.message);
  }
  // Always apply canonical names, bracket, and draft on top of saved data
  // This preserves results/scores but ensures teams and owners are always correct
  data.playerNames = { ...PLAYER_NAMES };
  const canonical = buildCanonicalTeams();
  for (let ri = 0; ri < 4; ri++) {
    if (!data.teams[ri]) data.teams[ri] = {};
    for (let s = 1; s <= 16; s++) {
      if (!data.teams[ri][s]) data.teams[ri][s] = {};
      data.teams[ri][s].name = canonical[ri][s].name;
      data.teams[ri][s].owner = canonical[ri][s].owner;
    }
  }
  if (!data.results) data.results = {};
  if (!data.ffResults) data.ffResults = {};
  if (!data.log) data.log = [];
  return data;
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

// ESPN scores proxy — fetches tournament results from ESPN's public API
app.get('/api/espn-scores', async (req, res) => {
  const https = require('https');
  // 2026 NCAA Tournament dates
  const tournamentDates = [
    '20260317','20260318', // First Four
    '20260319','20260320', // Round of 64
    '20260321','20260322', // Round of 32
    '20260326','20260327', // Sweet 16
    '20260328','20260329', // Elite 8
    '20260404',            // Final Four
    '20260406'             // Championship
  ];

  function fetchDate(date) {
    return new Promise((resolve, reject) => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&groups=100&limit=200`;
      https.get(url, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve({ events: [] }); }
        });
      }).on('error', () => resolve({ events: [] }));
    });
  }

  try {
    const allGames = [];
    // Fetch all dates in parallel
    const results = await Promise.all(tournamentDates.map(d => fetchDate(d)));
    results.forEach(dayData => {
      (dayData.events || []).forEach(event => {
        const comp = event.competitions?.[0];
        if (!comp) return;
        // Only include NCAA tournament games (check notes or season type)
        const isTourney = event.season?.slug === 'post-season' ||
          (comp.notes && comp.notes.some(n => (n.headline || '').toLowerCase().includes('ncaa'))) ||
          (event.name || '').toLowerCase().includes('ncaa') ||
          (comp.type?.abbreviation === 'NCAA');

        const competitors = comp.competitors || [];
        if (competitors.length !== 2) return;

        const game = {
          id: event.id,
          name: event.name || '',
          status: comp.status?.type?.description || 'Scheduled',
          completed: comp.status?.type?.completed || false,
          round: '',
          competitors: competitors.map(c => ({
            name: c.team?.displayName || c.team?.shortDisplayName || '',
            shortName: c.team?.shortDisplayName || c.team?.displayName || '',
            abbreviation: c.team?.abbreviation || '',
            seed: c.curatedRank?.current || 0,
            score: parseInt(c.score) || 0,
            winner: c.winner || false,
            homeAway: c.homeAway || ''
          }))
        };

        // Try to extract round info from notes
        if (comp.notes?.length) {
          game.round = comp.notes[0].headline || '';
        }

        allGames.push(game);
      });
    });

    res.json({ games: allGames, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('ESPN fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch scores from ESPN' });
  }
});

// Odds API proxy — fetches betting odds for NCAA tournament games (1 API request)
const ODDS_API_KEY = process.env.ODDS_API_KEY || 'afb3d4874715b9a2dac8b6f9a3fefa2b';
app.get('/api/odds', async (req, res) => {
  if (!ODDS_API_KEY) {
    return res.status(400).json({ error: 'No ODDS_API_KEY configured. Add it in Render environment variables.' });
  }
  const https = require('https');
  const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;

  https.get(url, (resp) => {
    let data = '';
    resp.on('data', chunk => data += chunk);
    resp.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        // Return remaining API requests info from headers
        const remaining = resp.headers['x-requests-remaining'] || '?';
        const used = resp.headers['x-requests-used'] || '?';
        res.json({ odds: parsed, remaining, used, fetchedAt: new Date().toISOString() });
      } catch(e) {
        res.status(500).json({ error: 'Failed to parse odds data' });
      }
    });
  }).on('error', (err) => {
    res.status(500).json({ error: 'Failed to fetch odds: ' + err.message });
  });
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
