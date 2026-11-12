"use strict";

process.env.TZ = process.env.TZ || "Asia/Bangkok";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 8001;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, "data", "bookings.json");
const BOOKING_DAYS = 14;
const SLOT_MINUTES = 30;
const LAST_SLOT = 20 * 60 + 30;
const SKIPPED_SLOT = 20 * 60;
const WEEKDAY_OPEN = 17 * 60;
const WEEKEND_OPEN = 13 * 60;
const PRICE = 50;
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_API_ORIGINS = new Set(["https://thunwa-leo.github.io"]);

const eventClients = new Set();


const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/admin", { file: "admin.html", type: "text/html; charset=utf-8", noindex: true }],
]);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let bookings = loadBookings();

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  result.setHours(0, 0, 0, 0);
  return result;
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return null;
  const [year, month, day] = String(key).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return startOfDay(date);
}

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function getOpenTime(date) {
  return isWeekend(date) ? WEEKEND_OPEN : WEEKDAY_OPEN;
}

function getSlotStarts(date) {
  const starts = [];
  for (let minutes = getOpenTime(date); minutes <= LAST_SLOT; minutes += SLOT_MINUTES) {
    if (minutes !== SKIPPED_SLOT) starts.push(minutes);
  }
  return starts;
}

function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;
}

function createCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "BC-";
    for (let index = 0; index < 4; index += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
  } while (bookings.some((booking) => booking.code === code));
  return code;
}

function loadBookings() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]\n", { mode: 0o600 });
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("ข้อมูลการจองไม่ถูกต้อง");
    return parsed;
  } catch (error) {
    console.error(`อ่านข้อมูลการจองไม่ได้: ${error.message}`);
    process.exit(1);
  }
}

function saveBookings() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(bookings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tempFile, DATA_FILE);
}

function writeSecurityHeaders(res, noindex = false) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Cross-Origin-Resource-Policy",
    res.__apiCors ? "cross-origin" : "same-origin"
  );
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  if (noindex) res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

function applyApiCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_API_ORIGINS.has(origin)) return;
  res.__apiCors = true;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, message, extraHeaders = {}) {
  const body = `${message}\n`;
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  if (pathname === "/admin.html" || pathname === "/admin/") {
    res.writeHead(302, { Location: "/admin", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (pathname === "/index.html") {
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  const entry = STATIC_FILES.get(pathname);
  if (!entry) {
    sendText(res, 404, "ไม่พบหน้าที่ต้องการ");
    return;
  }

  let content;
  try {
    content = fs.readFileSync(path.join(__dirname, entry.file));
  } catch {
    sendText(res, 500, "ไม่พบไฟล์ของเว็บไซต์");
    return;
  }

  writeSecurityHeaders(res, Boolean(entry.noindex));
  res.writeHead(200, {
    "Content-Type": entry.type,
    "Cache-Control": "no-store",
    "Content-Length": content.length,
  });
  if (req.method === "HEAD") res.end();
  else res.end(content);
}

function readJsonBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limitBytes) {
        tooLarge = true;
        reject(new HttpError(413, "BODY_TOO_LARGE", "ข้อมูลมีขนาดใหญ่เกินไป"));
        return;
      }
      raw += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (tooLarge) return;
      if (!raw.trim()) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new HttpError(400, "INVALID_JSON", "รูปแบบข้อมูลไม่ถูกต้อง"));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, "INVALID_JSON", "รูปแบบข้อมูลไม่ถูกต้อง"));
      }
    });

    req.on("error", () => {
      reject(new HttpError(400, "REQUEST_ERROR", "อ่านข้อมูลไม่สำเร็จ"));
    });
  });
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getPublicAvailability(fromKey, toKey) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) {
    throw new HttpError(400, "INVALID_DATE", "รูปแบบวันที่ไม่ถูกต้อง");
  }
  if (to < from) {
    throw new HttpError(400, "INVALID_RANGE", "ช่วงวันที่ไม่ถูกต้อง");
  }
  if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
    throw new HttpError(400, "RANGE_TOO_LARGE", "เลือกช่วงวันที่ได้ไม่เกิน 31 วัน");
  }

  return bookings
    .filter((booking) => booking.date >= fromKey && booking.date <= toKey)
    .map((booking) => ({
      date: booking.date,
      startMinutes: booking.startMinutes,
    }));
}

function getTodayQueue() {
  const today = dateKey(new Date());
  const items = bookings
    .filter((booking) => booking.date === today)
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((booking, index) => ({
      ...booking,
      queueNo: index + 1,
      status:
        booking.status === "done" || booking.status === "called"
          ? booking.status
          : "waiting",
    }));

  const current = items.find((booking) => booking.status === "called") || null;
  const next =
    items.find(
      (booking) =>
        booking.status === "waiting" &&
        (!current || booking.startMinutes >= current.startMinutes)
    ) ||
    items.find((booking) => booking.status === "waiting") ||
    null;
  const waitingCount = items.filter((booking) => booking.status === "waiting").length;
  const doneCount = items.filter((booking) => booking.status === "done").length;

  return {
    date: today,
    serverDate: today,
    serverNow: Date.now(),
    nowMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
    total: items.length,
    waitingCount,
    doneCount,
    currentNo: current ? current.queueNo : null,
    current,
    next,
    bookings: items,
  };
}

function getPublicQueueState() {
  const queue = getTodayQueue();
  return {
    date: queue.date,
    currentNo: queue.currentNo,
    currentStartMinutes: queue.current ? queue.current.startMinutes : null,
    total: queue.total,
    waitingCount: queue.waitingCount,
    doneCount: queue.doneCount,
  };
}

function broadcastQueueUpdate({ availabilityChanged = false } = {}) {
  const payload = JSON.stringify({
    type: "update",
    availabilityChanged,
    queue: getPublicQueueState(),
    serverNow: Date.now(),
    at: Date.now(),
  });

  for (const client of eventClients) {
    try {
      client.write(`event: update\ndata: ${payload}\n\n`);
    } catch {
      eventClients.delete(client);
    }
  }
}

function openEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  res.write("retry: 3000\n\n");
  res.write(
    `event: update\ndata: ${JSON.stringify({
      type: "update",
      availabilityChanged: false,
      queue: getPublicQueueState(),
      serverNow: Date.now(),
      at: Date.now(),
    })}\n\n`
  );
  eventClients.add(res);

  req.on("close", () => {
    eventClients.delete(res);
  });
}

async function handleApi(req, res, pathname, url) {
  writeSecurityHeaders(res);

  if (pathname === "/api/booking-status" && req.method === "GET") {
    const code = String(url.searchParams.get("code") || "")
      .trim()
      .toUpperCase();
    if (!/^BC-[A-Z0-9]{4}$/.test(code)) {
      throw new HttpError(400, "INVALID_CODE", "รหัสการจองไม่ถูกต้อง");
    }

    const booking = bookings.find((item) => item.code === code);
    if (!booking) {
      throw new HttpError(404, "BOOKING_NOT_FOUND", "ไม่พบการจองนี้");
    }

    const dayBookings = bookings
      .filter((item) => item.date === booking.date)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    const queueNo = dayBookings.findIndex((item) => item.id === booking.id) + 1;
    const current = dayBookings.find((item) => item.status === "called");
    const currentNo = current
      ? dayBookings.findIndex((item) => item.id === current.id) + 1
      : null;
    const status =
      booking.status === "called" || booking.status === "done"
        ? booking.status
        : "waiting";
    const today = dateKey(new Date());

    sendJson(res, 200, {
      code: booking.code,
      date: booking.date,
      startMinutes: booking.startMinutes,
      queueNo,
      status,
      currentNo,
      isToday: booking.date === today,
      serverNow: Date.now(),
    });
    return;
  }

  if (pathname === "/api/availability" && req.method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    sendJson(res, 200, {
      bookings: getPublicAvailability(from, to),
      queue: getPublicQueueState(),
      serverNow: Date.now(),
    });
    return;
  }

  if (pathname === "/api/bookings" && req.method === "POST") {
    const body = await readJsonBody(req);
    const nickname = cleanText(body.nickname, 30);
    const className = cleanText(body.className, 30);
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    const date = parseDateKey(body.date);
    const startMinutes = Number(body.startMinutes);

    if (!nickname) {
      throw new HttpError(400, "INVALID_NICKNAME", "กรุณากรอกชื่อเล่น");
    }
    if (!className) {
      throw new HttpError(400, "INVALID_CLASS", "กรุณากรอกชั้น");
    }
    if (!/^0\d{8,9}$/.test(phone)) {
      throw new HttpError(
        400,
        "INVALID_PHONE",
        "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678"
      );
    }
    if (!date) {
      throw new HttpError(400, "INVALID_DATE", "กรุณาเลือกวันที่");
    }

    const today = startOfDay(new Date());
    const lastBookable = addDays(today, BOOKING_DAYS - 1);
    if (date < today || date > lastBookable) {
      throw new HttpError(
        400,
        "OUT_OF_RANGE",
        "เลือกวันได้ภายใน 14 วันข้างหน้าตามช่วงเวลาเปิดร้าน"
      );
    }

    const allowedStarts = getSlotStarts(date);
    if (!Number.isInteger(startMinutes) || !allowedStarts.includes(startMinutes)) {
      throw new HttpError(400, "INVALID_SLOT", "ช่วงเวลานี้ไม่เปิดให้บริการ");
    }

    const now = new Date();
    if (
      date.getTime() === startOfDay(now).getTime() &&
      startMinutes <= now.getHours() * 60 + now.getMinutes()
    ) {
      throw new HttpError(400, "PAST_SLOT", "ช่วงเวลานี้ผ่านไปแล้ว");
    }

    const key = dateKey(date);
    if (
      bookings.some(
        (booking) =>
          booking.date === key && booking.startMinutes === startMinutes
      )
    ) {
      throw new HttpError(409, "SLOT_TAKEN", "ช่วงเวลานี้มีคิวแล้ว");
    }

    const booking = {
      id: crypto.randomUUID(),
      code: createCode(),
      date: key,
      startMinutes,
      nickname,
      className,
      phone,
      price: PRICE,
      status: "waiting",
      createdAt: new Date().toISOString(),
    };

    bookings.push(booking);
    try {
      saveBookings();
    } catch (error) {
      bookings = bookings.filter((item) => item.id !== booking.id);
      console.error(`บันทึกข้อมูลไม่สำเร็จ: ${error.message}`);
      throw new HttpError(500, "SAVE_FAILED", "บันทึกการจองไม่สำเร็จ");
    }

    broadcastQueueUpdate({ availabilityChanged: true });
    sendJson(res, 201, { booking });
    return;
  }

  if (pathname === "/api/queue" && req.method === "GET") {
    sendJson(res, 200, getTodayQueue());
    return;
  }

  if (pathname === "/api/queue/next" && req.method === "POST") {
    await readJsonBody(req);
    const today = dateKey(new Date());
    const sorted = bookings
      .filter((booking) => booking.date === today)
      .sort((a, b) => a.startMinutes - b.startMinutes);

    const current = sorted.find((booking) => booking.status === "called");
    const waiting = sorted.filter(
      (booking) =>
        booking.status !== "done" &&
        booking.status !== "called"
    );

    if (!current && waiting.length === 0) {
      throw new HttpError(409, "NO_QUEUE", "วันนี้ไม่มีคิวให้เรียกแล้ว");
    }

    const nowIso = new Date().toISOString();
    if (current) {
      current.status = "done";
      current.doneAt = nowIso;
    }

    const next =
      (current
        ? waiting.find(
            (booking) => booking.startMinutes >= current.startMinutes
          )
        : waiting[0]) ||
      waiting[0] ||
      null;
    if (next) {
      next.status = "called";
      next.calledAt = nowIso;
    }

    saveBookings();
    broadcastQueueUpdate({ availabilityChanged: false });
    sendJson(res, 200, getTodayQueue());
    return;
  }

  if (pathname.startsWith("/api/")) {
    throw new HttpError(404, "NOT_FOUND", "ไม่พบ API ที่ต้องการ");
  }
}

const heartbeat = setInterval(() => {
  for (const client of eventClients) {
    try {
      client.write(": ping\n\n");
    } catch {
      eventClients.delete(client);
    }
  }
}, 25000);
heartbeat.unref();

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    sendText(res, 400, "คำขอไม่ถูกต้อง");
    return;
  }

  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    applyApiCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Cache-Control": "no-store",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }
  }
  if (pathname === "/api/events" && req.method === "GET") {
    openEventStream(req, res);
    return;
  }
  if (pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, pathname, url);
    } catch (error) {
      if (res.headersSent) return;
      writeSecurityHeaders(res);
      if (error instanceof HttpError) {
        sendJson(res, error.status, {
          error: error.code,
          message: error.message,
        });
      } else {
        console.error(error);
        sendJson(res, 500, {
          error: "SERVER_ERROR",
          message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
        });
      }
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`เสี่ยแภคบาร์เบอร์ หน้าเว็บลูกค้า: http://localhost:${PORT}/`);
  console.log(`เสี่ยแภคบาร์เบอร์ หลังบ้านร้าน: http://localhost:${PORT}/admin`);
  console.log(`ข้อมูลการจอง: ${DATA_FILE}`);
});
