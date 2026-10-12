import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { scheduleKaiRetention } from "./kai/retention";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`Shop AI backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  scheduleKaiRetention();
});
