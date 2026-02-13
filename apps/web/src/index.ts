import { createServer } from "node:http";

const port = Number(process.env.WEB_PORT ?? 5173);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Read→Do Inbox</title>
  </head>
  <body>
    <main>
      <h1>Read→Do Web</h1>
      <p>MVP web shell is initialized.</p>
    </main>
  </body>
</html>`;

createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Web shell running on http://localhost:${port}`);
});
