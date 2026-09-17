const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to SQLite database.');
});

// Create Database Tables & Schema Migrations
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      points INTEGER DEFAULT 0,
      lifetime_points INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all(`PRAGMA table_info(members)`, (err, columns) => {
    if (err) return console.error('Migration read failed:', err.message);

    const hasLifetimePoints = Array.isArray(columns) && columns.some((column) => column.name === 'lifetime_points');
    if (!hasLifetimePoints) {
      db.run(`ALTER TABLE members ADD COLUMN lifetime_points INTEGER DEFAULT 0`, (alterErr) => {
        if (alterErr) console.error('Migration add column failed:', alterErr.message);
        else {
          db.run(`UPDATE members SET lifetime_points = points WHERE lifetime_points IS NULL OR lifetime_points = 0`);
        }
      });
    } else {
      db.run(`UPDATE members SET lifetime_points = points WHERE lifetime_points IS NULL OR lifetime_points = 0`);
    }
  });

  // Ledger for tracking point expiration (90 days)
  db.run(`
    CREATE TABLE IF NOT EXISTS point_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      points_earned INTEGER NOT NULL,
      points_remaining INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Outbox table for tier upgrade notifications
  db.run(`
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// Level 1 Twist: Tier Calculation with Platinum, Gold, Silver, and Bronze
function getTierInfo(member) {
  const lifetime = Number(member.lifetime_points ?? member.points ?? 0);

  if (lifetime >= 5000) {
    return { tier: 'Platinum', ratePerRupee: 0.3, displayMultiplier: '0.3 pts/₹' };
  }
  if (lifetime >= 500) {
    return { tier: 'Gold', ratePerRupee: 0.02, displayMultiplier: '2x pts/₹100' };
  }
  if (lifetime >= 200) {
    return { tier: 'Silver', ratePerRupee: 0.015, displayMultiplier: '1.5x pts/₹100' };
  }

  // Base tier for 0 to 199 points
  return { tier: 'Bronze', ratePerRupee: 0.01, displayMultiplier: '1x pts/₹100' };
}

// Helper: Format member output for API responses
function formatMember(member) {
  const tierInfo = getTierInfo(member);
  return {
    ...member,
    tier: tierInfo.tier,
    multiplier: tierInfo.ratePerRupee,
    displayMultiplier: tierInfo.displayMultiplier
  };
}

// 1. Register New Member
app.post('/api/members', (req, res) => {
  const { name, phone, email } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone number are required.' });
  }

  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) {
    return res.status(400).json({ error: 'Phone number cannot be empty.' });
  }

  db.get(`SELECT id FROM members WHERE phone = ?`, [cleanPhone], (err, existingMember) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (existingMember) {
      return res.status(400).json({ error: 'A member with this phone number already exists.' });
    }

    const query = `INSERT INTO members (name, phone, email, points, lifetime_points) VALUES (?, ?, ?, 0, 0)`;
    db.run(query, [name.trim(), cleanPhone, email ? email.trim() : ''], function (err) {
      if (err) return res.status(500).json({ error: 'Failed to register member.' });

      db.get(`SELECT * FROM members WHERE id = ?`, [this.lastID], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error.' });
        res.status(201).json(formatMember(row));
      });
    });
  });
});

// 2. Phone Lookup
app.get('/api/members/lookup', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone number parameter is required.' });

  const normalized = normalizePhone(phone);
  db.get(`SELECT * FROM members WHERE phone = ?`, [normalized], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!row) return res.status(404).json({ error: 'Member not found.' });

    res.json(formatMember(row));
  });
});

// 3. Record Purchase & Add Points (Level 1 + Level 3 Notifications)
app.post('/api/transactions/earn', (req, res) => {
  const { phone, billAmount } = req.body;
  const amount = parseFloat(billAmount);

  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid bill amount.' });
  }

  const searchPhone = normalizePhone(phone);

  db.get(`SELECT * FROM members WHERE phone = ?`, [searchPhone], (err, member) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!member) return res.status(404).json({ error: 'Member not found.' });

    const currentTierInfo = getTierInfo(member);
    const oldTier = currentTierInfo.tier;

    const earnedPoints = Math.floor(amount * currentTierInfo.ratePerRupee);
    const newPoints = member.points + earnedPoints;
    const newLifetime = Number(member.lifetime_points || 0) + earnedPoints;

    const updatedMember = { ...member, points: newPoints, lifetime_points: newLifetime };
    const newTier = getTierInfo(updatedMember).tier;

    // Update database
    db.run(`UPDATE members SET points = ?, lifetime_points = ? WHERE id = ?`, [newPoints, newLifetime, member.id], function (err) {
      if (err) return res.status(500).json({ error: 'Failed to update points.' });

      // Add to expiration ledger
      db.run(`INSERT INTO point_ledger (member_id, points_earned, points_remaining, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, [member.id, earnedPoints, earnedPoints]);

      // Level 3: Outbox Trigger on Tier Upgrade
      if (oldTier !== newTier) {
        const payload = JSON.stringify({ member_id: member.id, old_tier: oldTier, new_tier: newTier });
        db.run(`INSERT INTO outbox (member_id, event_type, payload) VALUES (?, 'TIER_UPGRADE', ?)`, [member.id, payload]);
      }

      res.json({
        message: `Added ${earnedPoints} points successfully!`,
        earnedPoints,
        member: formatMember(updatedMember)
      });
    });
  });
});

// 4. Redeem Reward
app.post('/api/transactions/redeem', (req, res) => {
  const { phone, cost } = req.body;
  const pointsToDeduct = parseInt(cost, 10);

  if (isNaN(pointsToDeduct) || pointsToDeduct <= 0) {
    return res.status(400).json({ error: 'Invalid reward point cost.' });
  }

  const searchPhone = normalizePhone(phone);

  db.get(`SELECT * FROM members WHERE phone = ?`, [searchPhone], (err, member) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!member) return res.status(404).json({ error: 'Member not found.' });

    if (member.points < pointsToDeduct) {
      return res.status(400).json({
        error: `Insufficient points balance. Required: ${pointsToDeduct} pts, Available: ${member.points} pts.`
      });
    }

    const newPoints = member.points - pointsToDeduct;

    db.run(`UPDATE members SET points = ? WHERE id = ?`, [newPoints, member.id], function (err) {
      if (err) return res.status(500).json({ error: 'Failed to redeem reward.' });

      res.json({
        message: 'Reward redeemed successfully!',
        redeemedPoints: pointsToDeduct,
        member: formatMember({ ...member, points: newPoints })
      });
    });
  });
});

// 5. Level 2: Clock API for 90-Day Expiration (Synchronized safely)
app.post('/clock', (req, res) => {
  const { current_time } = req.body;
  const now = current_time ? new Date(current_time) : new Date();
  const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));

  db.all(`SELECT * FROM point_ledger WHERE points_remaining > 0 ORDER BY created_at ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error.' });

    const expiredRows = rows.filter((row) => new Date(row.created_at) <= ninetyDaysAgo);

    if (expiredRows.length === 0) {
      return res.json({ message: 'Clock processed. No stale points expired.', expiredPoints: 0, affectedMembers: 0 });
    }

    let completed = 0;
    let expiredTotal = 0;

    expiredRows.forEach((row) => {
      expiredTotal += Number(row.points_remaining || 0);

      db.get(`SELECT points FROM members WHERE id = ?`, [row.member_id], (err, memberRow) => {
        if (err) return;

        const currentPoints = Number(memberRow?.points || 0);
        const reducedPoints = Math.max(0, currentPoints - Number(row.points_remaining || 0));

        db.run(`UPDATE members SET points = ? WHERE id = ?`, [reducedPoints, row.member_id], () => {
          db.run(`UPDATE point_ledger SET points_remaining = 0 WHERE id = ?`, [row.id], () => {
            completed += 1;
            if (completed === expiredRows.length) {
              res.json({
                message: 'Clock processed and stale points expired successfully.',
                expiredPoints: expiredTotal,
                affectedMembers: completed
              });
            }
          });
        });
      });
    });
  });
});

// 6. Level 3: Outbox Endpoint
app.get('/outbox', (req, res) => {
  db.all(`SELECT * FROM outbox ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    res.json(rows);
  });
});

// 7. Member Directory
app.get('/api/members', (req, res) => {
  const searchTerm = String(req.query.search || '').trim();
  const search = searchTerm ? `%${searchTerm}%` : '%';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  const countQuery = `SELECT COUNT(*) AS total FROM members WHERE name LIKE ? OR phone LIKE ?`;
  const dataQuery = `
    SELECT * FROM members 
    WHERE name LIKE ? OR phone LIKE ? 
    ORDER BY id DESC 
    LIMIT ? OFFSET ?
  `;

  db.get(countQuery, [search, search], (err, countResult) => {
    if (err) return res.status(500).json({ error: 'Database error.' });

    db.all(dataQuery, [search, search, limit, offset], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error.' });

      res.json({
        members: rows.map(formatMember),
        total: countResult.total,
        page,
        totalPages: Math.ceil(countResult.total / limit) || 1
      });
    });
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});