import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import config from "../config.js";
import logger from "../utils/logger.js";

const TOKEN_PATH = path.resolve("tokens/youtube_token.json");
const CATEGORY_ID_SPORTS = "17";

function getOAuthClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`YouTube token not found at ${TOKEN_PATH}. Run: node scripts/youtube-auth.js`);
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  const client = new google.auth.OAuth2(config.youtube.clientId, config.youtube.clientSecret, config.youtube.redirectUri);
  client.setCredentials(tokens);
  return client;
}

/**
 * Upload the assembled video to YouTube as a Short.
 * @param {{ videoPath: string, content: { title: string, description: string, hashtags: string[] } }} params
 */
export async function uploadYouTube({ videoPath, content }) {
  if (config.dryRun) {
    logger.info("step 07: DRY RUN — skipped YouTube upload");
    return { skipped: true, videoId: null };
  }

  const auth = getOAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  const hashtagLine = (content.hashtags || []).join(" ");
  const description = `${content.description}\n\n${hashtagLine} #Shorts`.trim();

  try {
    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: content.title,
          description,
          categoryId: CATEGORY_ID_SPORTS,
          tags: (content.hashtags || []).map((h) => h.replace(/^#/, ""))
        },
        status: {
          privacyStatus: config.youtube.privacyStatus,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    });

    const videoId = res.data.id;
    logger.info({ videoId }, "step 07: uploaded to YouTube");
    return { skipped: false, videoId };
  } catch (err) {
    const reason = err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") {
      const quotaErr = new Error("YouTube quota exceeded");
      quotaErr.code = "youtube_quota";
      throw quotaErr;
    }
    throw err;
  }
}

export { TOKEN_PATH };
