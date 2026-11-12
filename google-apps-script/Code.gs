const TIME_ZONE = "Asia/Bangkok";
const SPREADSHEET_ID = "1wRftatxh8HMBnOZkXAWq9UkoJt-oFofaj7O-e5QzU5A";
const SLOT_MINUTES = 30;
const WEEKDAY_OPEN = 17 * 60;
const WEEKEND_OPEN = 13 * 60;
const LAST_SLOT = 20 * 60 + 30;
const SKIPPED_SLOT = 20 * 60;
const BOOKING_DAYS = 14;
const PRICE = 50;
const SHEET_NAME = "Bookings";
const HEADERS = [
  "id",
  "code",
  "date",
  "startMinutes",
  "nickname",
  "className",
  "phone",
  "price",
  "status",
  "createdAt",
  "calledAt",
  "doneAt",
];

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function doGet(e) {
  const page =
    e && e.parameter && e.parameter.page === "admin" ? "admin" : "index";
  const title =
    page === "admin"
      ? "เรียกคิว — เสี่ยแภคบาร์เบอร์"
      : "เสี่ยแภคบาร์เบอร์ — จองคิวตัดผม 50 บาท";
  return HtmlService.createHtmlOutputFromFile(page)
    .setTitle(title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleApi(request) {
  try {
    const path = String((request && request.path) || "");
    const parts = path.split("?");
    const pathname = parts[0];
    const params = parseQuery_(parts[1] || "");
    const method = String((request && request.method) || "GET").toUpperCase();
    const body =
      request && request.body && typeof request.body === "object"
        ? request.body
        : {};
    let data;

    if (pathname === "/api/availability" && method === "GET") {
      data = getAvailability_(params.from, params.to);
    } else if (pathname === "/api/bookings" && method === "POST") {
      data = createBooking_(body);
    } else if (pathname === "/api/queue" && method === "GET") {
      data = getTodayQueue_();
    } else if (pathname === "/api/queue/next" && method === "POST") {
      data = callNext_();
    } else if (pathname === "/api/queue/delete" && method === "POST") {
      data = deleteBooking_(body);
    } else if (pathname === "/api/booking-status" && method === "GET") {
      data = getBookingStatus_(params.code);
    } else {
      throw new ApiError(404, "NOT_FOUND", "ไม่พบ API ที่ต้องการ");
    }

    return { ok: true, data: data };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        status: error.status,
        code: error.code,
        message: error.message,
      };
    }
    console.error(error);
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
    };
  }
}

function parseQuery_(query) {
  const params = {};
  if (!query) return params;
  query.split("&").forEach(function (part) {
    if (!part) return;
    const pair = part.split("=");
    params[decodeURIComponent(pair[0])] = decodeURIComponent(
      (pair[1] || "").replace(/\+/g, " ")
    );
  });
  return params;
}

function getSheet_() {
  const spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new ApiError(
      500,
      "SHEET_NOT_FOUND",
      "ไม่พบ Google Sheets ที่ผูกกับสคริปต์"
    );
  }
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange("C:C").setNumberFormat("@");
    sheet.getRange("G:G").setNumberFormat("@");
    sheet.getRange("J:L").setNumberFormat("@");
  }
  return sheet;
}

function readBookings_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet
    .getRange(2, 1, lastRow - 1, HEADERS.length)
    .getValues();
  return values
    .filter(function (row) {
      return String(row[0] || "").trim() !== "";
    })
    .map(function (row) {
      return {
        id: String(row[0]),
        code: String(row[1] || ""),
        date: cellDateKey_(row[2]),
        startMinutes: Number(row[3]) || 0,
        nickname: String(row[4] || ""),
        className: String(row[5] || ""),
        phone: String(row[6] || ""),
        price: Number(row[7]) || PRICE,
        status: String(row[8] || "waiting"),
        createdAt: cellIso_(row[9]),
        calledAt: cellIso_(row[10]),
        doneAt: cellIso_(row[11]),
      };
    });
}

function cellDateKey_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIME_ZONE, "yyyy-MM-dd");
  }
  return String(value || "").slice(0, 10);
}

function cellIso_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function appendBooking_(booking) {
  const sheet = getSheet_();
  sheet.appendRow([
    booking.id,
    booking.code,
    booking.date,
    booking.startMinutes,
    booking.nickname,
    booking.className,
    booking.phone,
    booking.price,
    booking.status,
    booking.createdAt,
    booking.calledAt || "",
    booking.doneAt || "",
  ]);
  SpreadsheetApp.flush();
}

function updateBookingStatus_(bookings, id, status) {
  const sheet = getSheet_();
  const index = bookings.findIndex(function (booking) {
    return booking.id === id;
  });
  if (index < 0) return;
  const row = index + 2;
  sheet.getRange(row, 9).setValue(status);
  const now = new Date().toISOString();
  if (status === "called") sheet.getRange(row, 11).setValue(now);
  if (status === "done") sheet.getRange(row, 12).setValue(now);
  SpreadsheetApp.flush();
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function nowKey_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
}

function nowMinutes_() {
  const now = new Date();
  return (
    Number(Utilities.formatDate(now, TIME_ZONE, "HH")) * 60 +
    Number(Utilities.formatDate(now, TIME_ZONE, "mm"))
  );
}

function parseDateKey_(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return null;
  const parts = String(key).split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2]
  ) {
    return null;
  }
  return date;
}

function dateKeyFromDate_(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysKey_(key, days) {
  const date = parseDateKey_(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromDate_(date);
}

function isWeekendKey_(key) {
  const date = parseDateKey_(key);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function getOpenMinutes_(key) {
  return isWeekendKey_(key) ? WEEKEND_OPEN : WEEKDAY_OPEN;
}

function getSlotStarts_(key) {
  const starts = [];
  for (
    let minutes = getOpenMinutes_(key);
    minutes <= LAST_SLOT;
    minutes += SLOT_MINUTES
  ) {
    if (minutes !== SKIPPED_SLOT) starts.push(minutes);
  }
  return starts;
}

function formatTime_(minutes) {
  return (
    String(Math.floor(minutes / 60)).padStart(2, "0") +
    ":" +
    String(minutes % 60).padStart(2, "0")
  );
}

function createCode_(bookings) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const existing = {};
  bookings.forEach(function (booking) {
    existing[booking.code] = true;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "BC-";
    for (let index = 0; index < 4; index += 1) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    if (!existing[code]) return code;
  }
  throw new ApiError(500, "CODE_ERROR", "สร้างรหัสการจองไม่สำเร็จ");
}

function createBooking_(body) {
  const nickname = String(body.nickname || "").trim().replace(/\s+/g, " ");
  const className = String(body.className || "").trim();
  const phone = String(body.phone || "").replace(/\D/g, "");
  const dateKey = String(body.date || "");
  const startMinutes = Number(body.startMinutes);
  const today = nowKey_();

  if (!nickname) {
    throw new ApiError(400, "INVALID_NICKNAME", "กรุณากรอกชื่อเล่น");
  }
  if (!className) {
    throw new ApiError(400, "INVALID_CLASS", "กรุณากรอกชั้น");
  }
  if (!/^0\d{8,9}$/.test(phone)) {
    throw new ApiError(
      400,
      "INVALID_PHONE",
      "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678"
    );
  }
  if (!parseDateKey_(dateKey)) {
    throw new ApiError(400, "INVALID_DATE", "วันที่ไม่ถูกต้อง");
  }
  const lastBookable = addDaysKey_(today, BOOKING_DAYS - 1);
  if (dateKey < today || dateKey > lastBookable) {
    throw new ApiError(
      400,
      "OUT_OF_RANGE",
      "เลือกวันได้ภายใน 14 วันข้างหน้าตามช่วงเวลาเปิดร้าน"
    );
  }
  if (!getSlotStarts_(dateKey).includes(startMinutes)) {
    throw new ApiError(400, "INVALID_SLOT", "ช่วงเวลานี้ไม่เปิดให้บริการ");
  }
  if (
    dateKey === today &&
    startMinutes <= nowMinutes_()
  ) {
    throw new ApiError(400, "PAST_SLOT", "ช่วงเวลานี้ผ่านไปแล้ว");
  }

  return withLock_(function () {
    const bookings = readBookings_();
    if (
      bookings.some(function (booking) {
        return (
          booking.date === dateKey &&
          booking.startMinutes === startMinutes
        );
      })
    ) {
      throw new ApiError(409, "SLOT_TAKEN", "ช่วงเวลานี้มีคิวแล้ว");
    }
    const booking = {
      id: Utilities.getUuid(),
      code: createCode_(bookings),
      date: dateKey,
      startMinutes: startMinutes,
      nickname: nickname.slice(0, 30),
      className: className.slice(0, 30),
      phone: phone,
      price: PRICE,
      status: "waiting",
      createdAt: new Date().toISOString(),
    };
    appendBooking_(booking);
    return { booking: booking };
  });
}

function getPublicQueue_(dateKey, bookings) {
  const day = bookings
    .filter(function (booking) {
      return booking.date === dateKey;
    })
    .sort(function (a, b) {
      return a.startMinutes - b.startMinutes;
    });
  const current = day.find(function (booking) {
    return booking.status === "called";
  });
  const currentNo = current
    ? day.findIndex(function (booking) {
        return booking.id === current.id;
      }) + 1
    : null;
  return {
    date: dateKey,
    currentNo: currentNo,
    currentStartMinutes: current ? current.startMinutes : null,
    total: day.length,
    waitingCount: day.filter(function (booking) {
      return booking.status === "waiting";
    }).length,
    doneCount: day.filter(function (booking) {
      return booking.status === "done";
    }).length,
  };
}

function getAvailability_(from, to) {
  const today = nowKey_();
  const fromKey = parseDateKey_(from) ? from : today;
  const toKey = parseDateKey_(to) ? to : addDaysKey_(today, BOOKING_DAYS - 1);
  const bookings = readBookings_();
  return {
    bookings: bookings
      .filter(function (booking) {
        return booking.date >= fromKey && booking.date <= toKey;
      })
      .map(function (booking) {
        return {
          date: booking.date,
          startMinutes: booking.startMinutes,
          nickname: booking.nickname,
          className: booking.className,
        };
      }),
    queue: getPublicQueue_(today, bookings),
    serverNow: Date.now(),
  };
}

function getTodayQueue_() {
  const today = nowKey_();
  const bookings = readBookings_();
  const day = bookings
    .filter(function (booking) {
      return booking.date === today;
    })
    .sort(function (a, b) {
      return a.startMinutes - b.startMinutes;
    })
    .map(function (booking, index) {
      return {
        queueNo: index + 1,
        id: booking.id,
        code: booking.code,
        date: booking.date,
        startMinutes: booking.startMinutes,
        nickname: booking.nickname,
        className: booking.className,
        phone: booking.phone,
        price: booking.price,
        status: booking.status,
        createdAt: booking.createdAt,
      };
    });
  const current = day.find(function (booking) {
    return booking.status === "called";
  });
  const next = day.find(function (booking) {
    return booking.status === "waiting";
  });
  const publicQueue = getPublicQueue_(today, bookings);
  const lastBookable = addDaysKey_(today, BOOKING_DAYS - 1);
  const upcoming = bookings
    .filter(function (booking) {
      return (
        booking.date > today &&
        booking.date <= lastBookable &&
        booking.status !== "done"
      );
    })
    .sort(function (a, b) {
      return a.date === b.date
        ? a.startMinutes - b.startMinutes
        : a.date.localeCompare(b.date);
    })
    .map(function (booking) {
      return {
        id: booking.id,
        code: booking.code,
        date: booking.date,
        startMinutes: booking.startMinutes,
        nickname: booking.nickname,
        className: booking.className,
        phone: booking.phone,
        price: booking.price,
        status: booking.status,
      };
    });
  return {
    date: today,
    serverDate: today,
    serverNow: Date.now(),
    nowMinutes: nowMinutes_(),
    total: day.length,
    waitingCount: publicQueue.waitingCount,
    doneCount: publicQueue.doneCount,
    currentNo: current ? current.queueNo : null,
    current: current || null,
    next: next || null,
    bookings: day,
    upcoming: upcoming,
  };
}

function callNext_() {
  return withLock_(function () {
    const today = nowKey_();
    const bookings = readBookings_();
    const day = bookings
      .filter(function (booking) {
        return booking.date === today;
      })
      .sort(function (a, b) {
        return a.startMinutes - b.startMinutes;
      });
    const current = day.find(function (booking) {
      return booking.status === "called";
    });
    const next = day.find(function (booking) {
      return booking.status === "waiting";
    });
    if (current) updateBookingStatus_(bookings, current.id, "done");
    if (next) updateBookingStatus_(bookings, next.id, "called");
    return getTodayQueue_();
  });
}

function deleteBooking_(body) {
  const id = String((body && body.id) || "").trim();
  if (!id) {
    throw new ApiError(400, "INVALID_ID", "ไม่พบรหัสคิวที่จะลบ");
  }

  return withLock_(function () {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw new ApiError(404, "BOOKING_NOT_FOUND", "ไม่พบคิวนี้");
    }
    const values = sheet
      .getRange(2, 1, lastRow - 1, HEADERS.length)
      .getValues();
    const index = values.findIndex(function (row) {
      return String(row[0] || "") === id;
    });
    if (index < 0) {
      throw new ApiError(404, "BOOKING_NOT_FOUND", "ไม่พบคิวนี้");
    }
    sheet.deleteRow(index + 2);
    SpreadsheetApp.flush();
    return getTodayQueue_();
  });
}

function getBookingStatus_(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^BC-[A-Z0-9]{4}$/.test(normalized)) {
    throw new ApiError(400, "INVALID_CODE", "รหัสการจองไม่ถูกต้อง");
  }
  const bookings = readBookings_();
  const booking = bookings.find(function (item) {
    return item.code === normalized;
  });
  if (!booking) {
    throw new ApiError(404, "BOOKING_NOT_FOUND", "ไม่พบการจองนี้");
  }
  const day = bookings
    .filter(function (item) {
      return item.date === booking.date;
    })
    .sort(function (a, b) {
      return a.startMinutes - b.startMinutes;
    });
  const queueNo =
    day.findIndex(function (item) {
      return item.id === booking.id;
    }) + 1;
  const current = day.find(function (item) {
    return item.status === "called";
  });
  const currentNo = current
    ? day.findIndex(function (item) {
        return item.id === current.id;
      }) + 1
    : null;
  return {
    code: booking.code,
    date: booking.date,
    startMinutes: booking.startMinutes,
    queueNo: queueNo,
    status:
      booking.status === "called" || booking.status === "done"
        ? booking.status
        : "waiting",
    currentNo: currentNo,
    isToday: booking.date === nowKey_(),
    serverNow: Date.now(),
  };
}
