
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(__dirname, "schemes.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function loadSchemes() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("schemes.json must contain an array.");
  }

  return data;
}

function serveFile(req, res, pathname) {
  let requestedPath = pathname === "/" ? "/index.html" : pathname;

  try {
    requestedPath = decodeURIComponent(requestedPath);
  } catch {
    sendJSON(res, 400, { error: "Invalid URL path." });
    return;
  }

  const filePath = path.resolve(ROOT, "." + requestedPath);

  // Prevent access to files outside the project directory.
  if (
    filePath !== ROOT &&
    !filePath.startsWith(ROOT + path.sep)
  ) {
    sendJSON(res, 403, { error: "Access denied." });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      const status = error.code === "ENOENT" ? 404 : 500;
      sendJSON(res, status, {
        error: status === 404 ? "File not found." : "Could not read file."
      });
      return;
    }

    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    });

    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJSON(res, 405, { error: "Only GET requests are supported." });
    return;
  }

  let url;

  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
  } catch {
    sendJSON(res, 400, { error: "Invalid request URL." });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJSON(res, 200, {
      status: "ok",
      message: "GovScheme server is running."
    });
    return;
  }

  if (
    url.pathname === "/api/schemes" ||
    url.pathname === "/api/schemes/search"
  ) {
    try {
      const schemes = loadSchemes();
      const query = (url.searchParams.get("q") || "")
        .trim()
        .toLowerCase();

      const results = url.pathname === "/api/schemes/search" && query
        ? schemes.filter(scheme => {
            const searchableText = [
              scheme.name,
              scheme.title,
              scheme.description,
              scheme.summary,
              scheme.category,
              scheme.state,
              scheme.states,
              scheme.tags,
              scheme.benefit,
              scheme.benefits
            ].flat().join(" ").toLowerCase();

            return searchableText.includes(query);
          })
        : schemes;

      sendJSON(res, 200, results);
    } catch (error) {
      console.error("Scheme data error:", error.message);
      sendJSON(res, 500, {
        error: "Could not load schemes. Check backend/schemes.json."
      });
    }

    return;
  }

  serveFile(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`GovScheme is running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop the server.");
});
