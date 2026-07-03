import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import config from "../src/config.js";

const TOKEN_PATH = path.resolve("tokens/youtube_token.json");
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

async function main() {
  const client = new google.auth.OAuth2(config.youtube.clientId, config.youtube.clientSecret, config.youtube.redirectUri);

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
  });

  console.log("\n1. Open this URL in a browser and approve access:\n");
  console.log(authUrl);
  console.log("\n2. Waiting for the redirect back to this machine...\n");

  const redirectUrl = new URL(config.youtube.redirectUri);
  const port = Number(redirectUrl.port) || 80;

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      if (reqUrl.pathname !== redirectUrl.pathname) {
        res.writeHead(404);
        res.end();
        return;
      }
      const authCode = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(error ? `Auth failed: ${error}. You can close this tab.` : "Auth successful. You can close this tab.");
      server.close();
      if (error) reject(new Error(error));
      else resolve(authCode);
    });
    server.listen(port, () => console.log(`Listening on port ${port} for OAuth redirect...`));
  });

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.warn(
      "\nWarning: no refresh_token returned. If you have authorized this app before, revoke access at " +
      "https://myaccount.google.com/permissions and re-run this script."
    );
  }

  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nSaved tokens to ${TOKEN_PATH}`);
}

main().catch((err) => {
  console.error("YouTube auth failed:", err.message);
  process.exit(1);
});
