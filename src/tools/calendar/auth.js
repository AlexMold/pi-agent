import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is /app/src/tools/calendar. We need to go up 3 levels to reach /app
const ROOT = path.resolve(__dirname, "../../..");

const CREDENTIALS_PATH = path.join(ROOT, "credentials", "credentials.json");
const TOKEN_PATH = path.join(ROOT, "credentials", "token.json");
export const CALENDAR_ID = "primary";
export const DEFAULT_TZ = "Europe/Chisinau";

export function buildAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${CREDENTIALS_PATH}`);
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `token.json not found. Run 'node auth.js' once to authorize.`,
    );
  }

  const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  const creds = JSON.parse(raw);
  const { client_id, client_secret, redirect_uris } =
    creds.installed || creds.web || creds;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oAuth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens
  oAuth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  return oAuth2Client;
}
