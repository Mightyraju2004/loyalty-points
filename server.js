const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./loyalty.db", (err) => {
  if (err) {
    console.error("Database error:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

// ---------- DATABASE HELPERS ----------
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ---------- PASSWORD HELPERS ----------
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, storedPassword) {
  return new Promise((resolve, reject) => {
    const [salt, key] = storedPassword.split(":");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(
        crypto.timingSafeEqual(
          Buffer.from(key, "hex"),
          derivedKey
        )
      );
    });
  });
}

const sessions = new Map();
function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ---------- LOYALTY RULES ----------
function getTier(points) {
  if (points >= 1000) return "Platinum";
  if (points >= 500) return "Gold";
  return "Silver";
}

function getEarnRate(tier) {
  if (tier === "Platinum") return 3;
  if (tier === "Gold") return 2;
  return 1;
}

async function getMemberBalance(memberId) {
  const result = await get(
    `SELECT COALESCE(SUM(CASE WHEN type = 'EARN' THEN points ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type = 'REDEEM' THEN points ELSE 0 END), 0) AS balance FROM transactions WHERE member_id = ?`,
    [memberId]
  );
  return result ? result.balance : 0;
}

async function getMemberWithBalance(memberId) {
  const member = await get(`SELECT * FROM members WHERE id = ?`, [memberId]);
  if (!member) return null;
  const balance = await getMemberBalance(memberId);
  return { ...member, balance, tier: getTier(balance), earnRate: getEarnRate(getTier(balance)) };
}

// ---------- INITIALIZE DATABASE ----------
async function initializeDatabase() {
  try {
    await run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await run(
      `CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await run(
      `CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('EARN', 'REDEEM')),
        points INTEGER NOT NULL CHECK(points > 0),
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES members(id)
      )`
    );
    await run(
      `CREATE TABLE IF NOT EXISTS rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        points_required INTEGER NOT NULL,
        description TEXT
      )`
    );

    const rewardCount = await get(`SELECT COUNT(*) AS count FROM rewards`);
    if (rewardCount.count === 0) {
      await run(
        `INSERT INTO rewards (name, points_required, description) VALUES (?, ?, ?)`,
        ["Free Coffee", 100, "Redeem one regular coffee"]
      );
      await run(
        `INSERT INTO rewards (name, points_required, description) VALUES (?, ?, ?)`,
        ["Free Sandwich", 250, "Redeem one sandwich"]
      );
      await run(
        `INSERT INTO rewards (name, points_required, description) VALUES (?, ?, ?)`,
        ["Free Cake", 400, "Redeem one slice of cake"]
      );
    }
    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

// ---------- AUTH ----------
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    const existingUser = await get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existingUser) {
      return res.status(409).json({ error: "Email is already registered." });
    }
    const hashedPassword = await hashPassword(password);
    const result = await run(
      `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`,
      [name, email, hashedPassword]
    );
    res.status(201).json({ message: "Registration successful.", userId: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const user = await get(`SELECT * FROM users WHERE email = ?`, [email]);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const validPassword = await verifyPassword(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const token = createToken();
    sessions.set(token, user.id);
    res.json({ message: "Login successful.", token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
});

// ---------- MEMBERS ----------
app.post("/api/members", async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required." });
    }
    const result = await run(
      `INSERT INTO members (name, phone, email) VALUES (?, ?, ?)`,
      [name, phone, email || null]
    );
    const member = await getMemberWithBalance(result.id);
    res.status(201).json(member);
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "A member with this phone number already exists." });
    }
    console.error(error);
    res.status(500).json({ error: "Could not create member." });
  }
});

app.get("/api/members", async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

    const allowedSorts = { name: "m.name", phone: "m.phone", created_at: "m.created_at" };
    const sort = allowedSorts[req.query.sort] || "m.created_at";
    const order = String(req.query.order).toLowerCase() === "asc" ? "ASC" : "DESC";
    const offset = (page - 1) * limit;

    const searchValue = `%${search}%`;

    const countResult = await get(
      `SELECT COUNT(*) AS total FROM members WHERE name LIKE ? OR phone LIKE ?`,
      [searchValue, searchValue]
    );

    const members = await all(
      `SELECT m.*, COALESCE(SUM(CASE WHEN t.type = 'EARN' THEN t.points WHEN t.type = 'REDEEM' THEN -t.points ELSE 0 END), 0) AS balance
       FROM members m
       LEFT JOIN transactions t ON m.id = t.member_id
       WHERE m.name LIKE ? OR m.phone LIKE ?
       GROUP BY m.id
       ORDER BY ${sort} ${order}
       LIMIT ? OFFSET ?`,
      [searchValue, searchValue, limit, offset]
    );

    const formattedMembers = members.map((member) => ({
      ...member,
      tier: getTier(member.balance),
      earnRate: getEarnRate(getTier(member.balance))
    }));

    res.json({
      data: formattedMembers,
      pagination: { page, limit, total: countResult.total, totalPages: Math.ceil(countResult.total / limit) }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not fetch members." });
  }
});

app.get("/api/members/:id", async (req, res) => {
  try {
    const member = await getMemberWithBalance(req.params.id);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }
    res.json(member);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not fetch member." });
  }
});

app.get("/api/members/:id/balance", async (req, res) => {
  try {
    const member = await getMemberWithBalance(req.params.id);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }
    res.json({ memberId: member.id, balance: member.balance, tier: member.tier, earnRate: member.earnRate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not fetch balance." });
  }
});

// ---------- EARN POINTS ----------
app.post("/api/members/:id/earn", async (req, res) => {
  try {
    const member = await getMemberWithBalance(req.params.id);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }

    const { amount, points, description } = req.body;
    let earnedPoints = Number(points);

    if (amount !== undefined) {
      const purchaseAmount = Number(amount);
      if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
        return res.status(400).json({ error: "Purchase amount must be greater than zero." });
      }
      earnedPoints = Math.floor((purchaseAmount / 100) * member.earnRate);
    }

    if (!Number.isInteger(earnedPoints) || earnedPoints <= 0) {
      return res.status(400).json({ error: "Points must be a positive whole number." });
    }

    await run(
      `INSERT INTO transactions (member_id, type, points, description) VALUES (?, 'EARN', ?, ?)`,
      [member.id, earnedPoints, description || `Points earned at ${member.tier} tier`]
    );

    const updatedMember = await getMemberWithBalance(member.id);
    res.status(201).json({ message: "Points earned successfully.", transactionPoints: earnedPoints, member: updatedMember });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not earn points." });
  }
});

// ---------- REWARDS ----------
app.get("/api/rewards", async (req, res) => {
  try {
    const rewards = await all(`SELECT * FROM rewards ORDER BY points_required ASC`);
    res.json(rewards);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not fetch rewards." });
  }
});

app.post("/api/members/:id/redeem", async (req, res) => {
  try {
    const member = await getMemberWithBalance(req.params.id);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }

    const { rewardId } = req.body;
    if (!rewardId) {
      return res.status(400).json({ error: "Reward ID is required." });
    }

    const reward = await get(`SELECT * FROM rewards WHERE id = ?`, [rewardId]);
    if (!reward) {
      return res.status(404).json({ error: "Reward not found." });
    }

    if (member.balance < reward.points_required) {
      return res.status(400).json({ error: `Not enough points. You have ${member.balance} points but need ${reward.points_required}.` });
    }

    await run(
      `INSERT INTO transactions (member_id, type, points, description) VALUES (?, 'REDEEM', ?, ?)`,
      [member.id, reward.points_required, `Redeemed: ${reward.name}`]
    );

    const updatedMember = await getMemberWithBalance(member.id);
    res.status(201).json({ message: "Reward redeemed successfully.", reward, member: updatedMember });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not redeem reward." });
  }
});

// ---------- TRANSACTION HISTORY ----------
app.get("/api/members/:id/transactions", async (req, res) => {
  try {
    const member = await get(`SELECT id FROM members WHERE id = ?`, [req.params.id]);
    if (!member) {
      return res.status(404).json({ error: "Member not found." });
    }

    const transactions = await all(
      `SELECT * FROM transactions WHERE member_id = ? ORDER BY created_at DESC, id DESC`,
      [req.params.id]
    );
    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not fetch transactions." });
  }
});

// ---------- START SERVER ----------
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`http://localhost:${PORT}`);
  });
});