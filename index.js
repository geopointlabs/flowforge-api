require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const snowflake = require("snowflake-sdk");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["https://flowforgelabs.io"],
}));
app.use(express.json());

// Snowflake connection pool
const connectionPool = snowflake.createPool(
  {
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USERNAME,
    password: process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
  },
  { max: 5, min: 0 }
);

// Keep-alive: ping Snowflake every 4 minutes to prevent idle connection timeouts
const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000;
setInterval(async () => {
  try {
    const connection = await connectionPool.acquire();
    await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: "SELECT 1",
        complete: (err) => {
          connectionPool.release(connection);
          if (err) reject(err);
          else resolve();
        },
      });
    });
    console.log("Snowflake keep-alive ping successful");
  } catch (error) {
    console.error("Snowflake keep-alive ping failed:", error.message);
  }
}, KEEP_ALIVE_INTERVAL);

// Email validation
const isValidEmail = (email) => {
  const re = /^[^s@]+@[^s@]+.[^s@]+$/;
  return re.test(email);
};

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Waitlist signup endpoint
app.post("/api/waitlist", async (req, res) => {
  const { email } = req.body;

  // Validate
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  // Get client info
  const ipAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const connection = await connectionPool.acquire();

    // Check if email already exists
    const exists = await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: "SELECT COUNT(*) as count FROM WAITLIST WHERE email = ?",
        binds: [normalizedEmail],
        complete: (err, stmt, rows) => {
          if (err) reject(err);
          else resolve(rows[0]?.COUNT > 0);
        },
      });
    });

    if (exists) {
      connectionPool.release(connection);
      return res.status(409).json({ error: "This email is already on the waitlist" });
    }

    // Insert new signup
    await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: "INSERT INTO WAITLIST (email, ip_address, user_agent) VALUES (?, ?, ?)",
        binds: [normalizedEmail, ipAddress, userAgent.substring(0, 512)],
        complete: (err, stmt, rows) => {
          connectionPool.release(connection);
          if (err) reject(err);
          else resolve(rows);
        },
      });
    });

    res.json({ success: true, message: "Thanks for signing up!" });
  } catch (error) {
    console.error("Snowflake error:", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Admin authentication middleware
// Accepts either API key or admin password
const requireAdmin = (req, res, next) => {
  const apiKey = req.headers["x-admin-api-key"];
  const password = req.headers["x-admin-password"];
  
  const validApiKey = apiKey && apiKey === process.env.ADMIN_API_KEY;
  const validPassword = password && password === process.env.ADMIN_PASSWORD;
  
  if (!validApiKey && !validPassword) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Admin: Get all waitlist signups
app.get("/api/admin/waitlist", requireAdmin, async (req, res) => {
  try {
    const connection = await connectionPool.acquire();

    const rows = await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: `
          SELECT email, signed_up_at, ip_address, user_agent
          FROM WAITLIST
          ORDER BY signed_up_at DESC
        `,
        complete: (err, stmt, rows) => {
          connectionPool.release(connection);
          if (err) reject(err);
          else resolve(rows);
        },
      });
    });

    res.json({
      total: rows.length,
      signups: rows.map((row) => ({
        email: row.EMAIL,
        signedUpAt: row.SIGNED_UP_AT,
        ipAddress: row.IP_ADDRESS,
        userAgent: row.USER_AGENT,
      })),
    });
  } catch (error) {
    console.error("Snowflake error:", error);
    res.status(500).json({ error: "Failed to fetch waitlist" });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
