import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../dist");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || "/", `http://${host}`).pathname);
  let filePath = path.resolve(root, pathname.replace(/^\/+/, ""));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(root, "index.html");
  }

  res.writeHead(200, {
    "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host);
