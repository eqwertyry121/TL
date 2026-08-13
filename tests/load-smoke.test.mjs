import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";

test("load smoke verifies ETag and concurrent conditional 304 responses", async () => {
  let freshRequests = 0;
  let conditionalRequests = 0;
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/cached");
    const etag = "\"cached-v1\"";
    if (request.headers["if-none-match"] === etag) {
      conditionalRequests += 1;
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }
    freshRequests += 1;
    response.writeHead(200, {
      "Content-Type": "application/json",
      ETag: etag,
      "Server-Timing": "db;dur=3.4, encode;dur=0.6, total;dur=12",
    });
    response.end(JSON.stringify({ ok: true }));
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/cached",
        PERF_CONCURRENCY: "1,3",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
        PERF_VALIDATE_MEDIA: "false",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('"phase":"etag-validation"'));
    assert.ok(result.stdout.includes('"phase":"conditional"'));
    assert.ok(result.stdout.includes('"server_timing_p95_ms":{"db":3.4,"encode":0.6,"total":12}'));
    assert.equal(freshRequests, 5);
    assert.equal(conditionalRequests, 5);
  } finally {
    await close(server);
  }
});

test("load smoke verifies gzip for large JSON responses", async () => {
  const etag = "\"large-v1\"";
  const payload = JSON.stringify({ data: deterministicLargeText() });
  const gzipped = gzipSync(Buffer.from(payload));
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/large");
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      ETag: etag,
    });
    response.end(gzipped);
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/large",
        PERF_CONCURRENCY: "1",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
        PERF_VALIDATE_MEDIA: "false",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('"bad_compression":0'));
  } finally {
    await close(server);
  }
});

test("load smoke fails when a large JSON response is not gzip encoded", async () => {
  const etag = "\"large-v1\"";
  const payload = JSON.stringify({ data: deterministicLargeText() });
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/large");
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      ETag: etag,
    });
    response.end(payload);
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/large",
        PERF_CONCURRENCY: "1",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
        PERF_VALIDATE_MEDIA: "false",
      },
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stdout.includes('"bad_compression":1'));
  } finally {
    await close(server);
  }
});

test("load smoke fails when default ETag validation sees no ETag", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/uncached",
        PERF_CONCURRENCY: "1",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
        PERF_VALIDATE_MEDIA: "false",
      },
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stdout.includes('"reason":"missing_etag"'));
  } finally {
    await close(server);
  }
});

test("load smoke validates published menu media URLs", async () => {
  const etag = "\"menu-v1\"";
  const server = http.createServer((request, response) => {
    if (request.url === "/api/v1/menu?locale=ru") {
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { ETag: etag });
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
      });
      response.end(JSON.stringify({
        categories: [{
          items: [{
            photo_path: "/media/menu/display.jpg",
            photo_variants: {
              thumbnail: { url: "/media/menu/thumb.jpg" },
              display: { url: "/media/menu/display.jpg" },
            },
          }],
        }],
      }));
      return;
    }
    if (request.url === "/media/menu/display.jpg" || request.url === "/media/menu/thumb.jpg") {
      response.writeHead(200, { "Content-Type": "image/jpeg" });
      response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/api/v1/menu?locale=ru",
        PERF_CONCURRENCY: "1",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('"phase":"media-validation"'));
    assert.ok(result.stdout.includes('"checked":2'));
  } finally {
    await close(server);
  }
});

test("load smoke can run repeated checkout calculation in local/dev mode", async () => {
  const etag = "\"cached-v1\"";
  let calculateRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/cached") {
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { ETag: etag });
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/api/v1/dev/session" && request.method === "POST") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ session: { token: "checkout-token" }, roles: ["CLIENT"] }));
      return;
    }
    if (request.url === "/api/v1/orders/calculate" && request.method === "POST") {
      assert.equal(request.headers.authorization, "Bearer checkout-token");
      calculateRequests += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        items: [{
          item_id: "22222222-2222-2222-2222-222222222001",
          quantity: 5,
          unit_price_minor: 690,
          line_total_minor: 3450,
        }],
        total_minor: 3450,
      }));
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/cached",
        PERF_CONCURRENCY: "1",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
        PERF_VALIDATE_MEDIA: "false",
        PERF_CHECKOUT_ITERATIONS: "4",
        PERF_CHECKOUT_CONCURRENCY: "2",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('"phase":"checkout-session"'));
    assert.ok(result.stdout.includes('"phase":"checkout-calculate"'));
    assert.ok(result.stdout.includes('"iterations":4'));
    assert.ok(result.stdout.includes('"concurrency":2'));
    assert.equal(calculateRequests, 4);
  } finally {
    await close(server);
  }
});

test("load smoke fails when a published menu media URL is not an image response", async () => {
  const etag = "\"menu-v1\"";
  const server = http.createServer((request, response) => {
    if (request.url === "/api/v1/menu?locale=ru") {
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { ETag: etag });
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
      });
      response.end(JSON.stringify({
        categories: [{
          items: [{ photo_path: "/media/menu/broken.jpg" }],
        }],
      }));
      return;
    }
    if (request.url === "/media/menu/broken.jpg") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("not an image");
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });

  const baseURL = await listen(server);
  try {
    const result = await runLoadSmoke({
      env: {
        ...process.env,
        PERF_BASE_URL: baseURL,
        PERF_ENDPOINTS: "/api/v1/menu?locale=ru",
        PERF_CONCURRENCY: "1",
        PERF_MAX_P95_MS: "1000",
        PERF_TIMEOUT_MS: "1000",
      },
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stdout.includes('"phase":"media-validation"'));
    assert.ok(result.stdout.includes('"content_type":"text/plain"'));
  } finally {
    await close(server);
  }
});

function runLoadSmoke(options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/load-smoke.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function deterministicLargeText() {
  let state = 17;
  let output = "";
  for (let index = 0; index < 4096; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483647;
    output += String.fromCharCode(33 + (state % 90));
  }
  return output;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server did not expose a TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
