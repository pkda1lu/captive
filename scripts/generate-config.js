const crypto = require("node:crypto");

const portalHost = process.argv[2] || "captiveozon.online";
const vpsIp = process.argv[3] || "159.194.215.125";
const nasId = process.argv[4] || "router-01";
const uamSecret = crypto.randomBytes(24).toString("base64url");
const radiusSecret = crypto.randomBytes(24).toString("base64url");

const lines = [
  "Router fields",
  "-------------",
  `UAM Server: https://${portalHost}/`,
  `UAM Secret: ${uamSecret}`,
  `RADIUS-server 1: ${vpsIp}`,
  "RADIUS-server 2: leave empty",
  `RADIUS Secret: ${radiusSecret}`,
  `RADIUS NAS ID: ${nasId}`,
  "RADIUS location name: Main location",
  "RADIUS location ID: main-01",
  "DNS 1: 1.1.1.1",
  "DNS 2: 8.8.8.8",
  "",
  "VPS .env",
  "--------",
  `PORT=8080`,
  `DEFAULT_USERNAME=guest`,
  `DEFAULT_PASSWORD=guest`,
  `UAM_SECRET=${uamSecret}`,
  `RADIUS_SECRET=${radiusSecret}`,
  `PORTAL_HOST=${portalHost}`,
  "",
  "FreeRADIUS client block",
  "-----------------------",
  "client router_01 {",
  "  ipaddr = ROUTER_PUBLIC_WAN_IP",
  `  secret = ${radiusSecret}`,
  `  nas_type = other`,
  "}"
];

console.log(lines.join("\n"));
