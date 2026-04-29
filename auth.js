/**
 * auth.js — Run ONCE to authorize Google Calendar access.
 * Generates token.json which the bot uses for all future requests.
 *
 * Usage: node auth.js
 */

import { createRequire } from "module";
import fs from "fs";
import readline from "readline";
import { google } from "googleapis";

const require = createRequire(import.meta.url);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];
const CREDENTIALS_PATH = "./credentials/credentials.json";
const TOKEN_PATH = "./credentials/token.json";

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`❌ credentials.json not found at ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  const creds = JSON.parse(raw);

  // Support both flat and nested (installed/web) credential formats
  const { client_id, client_secret, redirect_uris } =
    creds.installed || creds.web || creds;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force refresh_token to be returned
  });

  console.log("\n🔐 Google Calendar OAuth2 Authorization\n");
  console.log("1. Open this URL in your browser:\n");
  console.log("   " + authUrl);
  console.log(
    "\n2. Sign in, allow access, then copy the code from the address bar.",
  );
  console.log(
    "   (It appears after ?code= and ends before &scope or similar)\n",
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("3. Paste the code here and press Enter: ", async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log(`\n✅ token.json saved! The bot can now manage your calendar.\n`);
    } catch (err) {
      console.error("\n❌ Failed to get token:", err.message);
      if (err.message.includes("redirect_uri_mismatch")) {
        console.error(
          "   → In Google Console, add this redirect URI: http://localhost",
        );
      }
    }
    process.exit(0);
  });
}

main();
