const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { exec } = require("node:child_process");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ACCESS_TTL_MS = Number(process.env.ACCESS_TTL_MINUTES || 480) * 60 * 1000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "access.json");
const GRANT_COMMAND = process.env.GRANT_COMMAND || "";
const DEFAULT_USERNAME = process.env.DEFAULT_USERNAME || "guest";
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "guest";

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

let accessList = new Map();

function now() {
  return Date.now();
}

function normalizeIp(value) {
  const first = String(value || "").split(",")[0].trim();
  return first.replace(/^::ffff:/, "") || "unknown";
}

function getClientIp(req) {
  return normalizeIp(req.headers["x-forwarded-for"] || req.socket.remoteAddress);
}

function isAuthorized(ip) {
  const entry = accessList.get(ip);
  if (!entry) return false;
  if (entry.expiresAt <= now()) {
    accessList.delete(ip);
    persistAccessList().catch((error) => console.error("persist failed:", error));
    return false;
  }
  return true;
}

async function loadAccessList() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    accessList = new Map(
      Object.entries(parsed.clients || {}).filter(([, entry]) => entry.expiresAt > now())
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function persistAccessList() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const clients = Object.fromEntries(accessList.entries());
  await fs.writeFile(DATA_FILE, JSON.stringify({ clients }, null, 2));
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function redirectToPortal(req, res) {
  const host = req.headers.host || `localhost:${PORT}`;
  const loginUrl = `http://${host}/`;
  res.writeHead(302, {
    Location: loginUrl,
    "Cache-Control": "no-store"
  });
  res.end();
}

async function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const body = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    send(res, 200, body, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  } catch (error) {
    if (error.code === "ENOENT") {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    throw error;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function runGrantCommand(ip, token) {
  if (!GRANT_COMMAND) return Promise.resolve({ skipped: true });

  const command = GRANT_COMMAND
    .replaceAll("{ip}", ip)
    .replaceAll("{token}", token);

  return new Promise((resolve, reject) => {
    exec(command, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function grantAccess(req, res) {
  const ip = getClientIp(req);
  const body = await readBody(req);
  const data = body ? JSON.parse(body) : {};
  const token = crypto.randomBytes(16).toString("hex");
  const entry = {
    ip,
    name: String(data.name || "").slice(0, 80),
    acceptedAt: new Date().toISOString(),
    expiresAt: now() + ACCESS_TTL_MS,
    token
  };

  accessList.set(ip, entry);
  await persistAccessList();

  try {
    await runGrantCommand(ip, token);
  } catch (error) {
    console.error(`grant command failed for ${ip}:`, error.stderr || error.message);
    sendJson(res, 500, {
      ok: false,
      message: "Access was recorded, but the network grant command failed."
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    ip,
    expiresAt: entry.expiresAt,
    redirectTo: data.redirectTo || "https://captiveportal.mytunnel.org/"
  });
}

function handleProbe(req, res, ip, pathname) {
  const isProbe =
    pathname === "/generate_204" ||
    pathname === "/hotspot-detect.html" ||
    pathname === "/ncsi.txt";

  if (!isProbe) return false;

  if (!isAuthorized(ip)) {
    redirectToPortal(req, res);
    return true;
  }

  if (pathname === "/generate_204") {
    send(res, 204, "");
    return true;
  }
  if (pathname === "/hotspot-detect.html") {
    send(res, 200, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>", {
      "Content-Type": "text/html; charset=utf-8"
    });
    return true;
  }
  if (pathname === "/ncsi.txt") {
    send(res, 200, "Microsoft NCSI", { "Content-Type": "text/plain; charset=utf-8" });
    return true;
  }
  return false;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const ip = getClientIp(req);

  if (handleProbe(req, res, ip, url.pathname)) return;

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      ip,
      authorized: isAuthorized(ip),
      expiresAt: accessList.get(ip)?.expiresAt || null
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/uam") {
    sendJson(res, 200, {
      username: DEFAULT_USERNAME,
      password: DEFAULT_PASSWORD
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/access") {
    await grantAccess(req, res);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
    await serveStatic(req, res, url.pathname);
    return;
  }

  if (!isAuthorized(ip)) {
    redirectToPortal(req, res);
    return;
  }

  send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
}

loadAccessList()
  .then(() => {
    http
      .createServer((req, res) => {
        handleRequest(req, res).catch((error) => {
          console.error(error);
          send(res, 500, "Internal server error", { "Content-Type": "text/plain; charset=utf-8" });
        });
      })
      .listen(PORT, HOST, () => {
        console.log(`Captive portal listening on http://${HOST}:${PORT}`);
      });
  })
  .catch((error) => {
    console.error("Failed to start captive portal:", error);
    process.exitCode = 1;
  });
