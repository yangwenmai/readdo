import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const port = Number(process.env.API_PORT ?? 8787);
  const app = await createApp();
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

export { createApp };
