const TOKEN = process.env.BOT_TOKEN || "8855409722:AAHBNK3XcUcEDrh5euSXRy6mVHZ2imZFLGQ";
const GROUP_ID = process.env.GROUP_ID || "-5137002293";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://pbkklacwpffvwgblxjus.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBia2tsYWN3cGZmdndnYmx4anVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTU0ODAwNCwiZXhwIjoyMDk1MTI0MDA0fQ.7RZlYftOQ5MiROxPlAg3dd7UpV9tUFpVCR4g52EjgcU";
const PORT = process.env.PORT || 3000;

const https = require("https");
const http = require("http");

// ===== Supabase Helper =====
function supabase(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "pbkklacwpffvwgblxjus.supabase.co",
      path: `/rest/v1/${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": method === "POST" ? "return=representation" : "return=minimal",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function saveTicket(ticket) {
  return supabase("POST", "tickets", ticket);
}

async function getTickets(status) {
  const filter = status ? `status=eq.${status}&` : "";
  return supabase("GET", `tickets?${filter}order=created_at.desc`);
}

async function updateTicket(id, data) {
  return supabase("PATCH", `tickets?id=eq.${id}`, data);
}

// ===== Telegram Helper =====
function tgApi(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sendMsg(chatId, text, extra = {}) {
  return tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

// ===== Message Handler =====
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

  if (!isGroup) {
    if (text === "/start") {
      await sendMsg(chatId, "👋 <b>بوت SAV</b>\n\n/list — قائمة الطلبات\n/stats — الإحصائيات");
    } else if (text === "/list") {
      const tickets = await getTickets();
      if (!tickets.length) { await sendMsg(chatId, "✅ لا توجد طلبات"); return; }
      const open = tickets.filter(t => !["done","closed"].includes(t.status));
      for (const t of open.slice(0, 5)) {
        await sendMsg(chatId, formatTicket(t), {
          reply_markup: { inline_keyboard: [[
            { text: "✅ تمت المعالجة", callback_data: `done_${t.id}` },
            { text: "🔄 قيد المعالجة", callback_data: `proc_${t.id}` }
          ]]}
        });
      }
    } else if (text === "/stats") {
      const tickets = await getTickets();
      const open = tickets.filter(t => !["done","closed"].includes(t.status)).length;
      const done = tickets.filter(t => t.status === "done").length;
      await sendMsg(chatId, `📊 <b>إحصائيات SAV</b>\n━━━━━━━━\n📁 الإجمالي: ${tickets.length}\n🟡 المفتوحة: ${open}\n✅ المعالجة: ${done}`);
    }
    return;
  }

  // Group: parse ticket
  if (text.match(/^(اسم|nom)\s*:/im)) {
    const lines = text.split("\n");
    let t = { report_date: new Date().toISOString().split("T")[0], status: "new" };
    for (const line of lines) {
      const l = line.trim();
      if (l.match(/^(اسم|nom)\s*:/i)) t.client_name = l.split(":").slice(1).join(":").trim();
      else if (l.match(/^(هاتف|tel|téléphone)\s*:/i)) t.phone = l.split(":").slice(1).join(":").trim();
      else if (l.match(/^(عنوان|adresse)\s*:/i)) t.address = l.split(":").slice(1).join(":").trim();
      else if (l.match(/^(عطب|problème|probleme|panne)\s*:/i)) t.problem_type = l.split(":").slice(1).join(":").trim();
      else if (l.match(/^(ملاحظات|notes)\s*:/i)) t.notes = l.split(":").slice(1).join(":").trim();
    }

    if (t.client_name && t.phone && t.address && t.problem_type) {
      const result = await saveTicket(t);
      const saved = Array.isArray(result) ? result[0] : result;
      const num = `SAV-${String(saved?.id || "???").padStart(3,"0")}`;
      await updateTicket(saved?.id, { ticket_num: num });
      await sendMsg(chatId, `✅ <b>تم تسجيل الطلب ${num}</b>\n━━━━━━━━━━━━━━\n🔧 <b>طلب SAV جديد</b>\n🆔 <b>رقم الطلب:</b> ${num}\n👤 <b>الاسم:</b> ${t.client_name}\n📱 <b>الهاتف:</b> ${t.phone}\n📍 <b>العنوان:</b> ${t.address}\n🔩 <b>نوع العطب:</b> ${t.problem_type}\n📅 <b>التاريخ:</b> ${t.report_date}\n🟡 <b>الحالة:</b> جديد`);
    } else {
      await sendMsg(chatId, `⚠️ معلومات ناقصة!\n\nالصيغة الصحيحة:\n<code>اسم: ...\nهاتف: ...\nعنوان: ...\nعطب: ...</code>`);
    }
    return;
  }

  if (text === "/list" || text === "/قائمة") {
    const tickets = await getTickets();
    const open = tickets.filter(t => !["done","closed"].includes(t.status));
    if (!open.length) { await sendMsg(chatId, "✅ لا توجد طلبات مفتوحة"); return; }
    let msg2 = `📋 <b>الطلبات المفتوحة (${open.length})</b>\n━━━━━━━━\n`;
    for (const t of open) {
      const statusIcon = t.status === "new" ? "🟡" : t.status === "processing" ? "🟠" : "🔵";
      msg2 += `\n${statusIcon} <b>${t.ticket_num || "SAV-?"}</b> | ${t.client_name} | ${t.problem_type}\n`;
    }
    await sendMsg(chatId, msg2);
    return;
  }

  if (text.startsWith("/done ") || text.startsWith("/تمت ")) {
    const parts = text.split(" ");
    const ticketNum = parts[1];
    const resolution = parts.slice(2).join(" ") || "تمت المعالجة";
    const id = parseInt(ticketNum?.replace(/SAV-/i, ""));
    const tickets = await getTickets();
    const ticket = tickets.find(t => t.id === id || t.ticket_num === ticketNum);
    if (!ticket) { await sendMsg(chatId, `❌ الطلب ${ticketNum} غير موجود`); return; }
    const doneDate = new Date().toISOString().split("T")[0];
    await updateTicket(ticket.id, { status: "done", resolution, resolution_date: doneDate });
    await sendMsg(chatId,
      `✅ <b>تمت معالجة ${ticket.ticket_num}</b>\n━━━━━━━━\n👤 ${ticket.client_name}\n📱 ${ticket.phone}\n📍 ${ticket.address}\n🔩 ${ticket.problem_type}\n✅ <b>ما تم:</b> ${resolution}\n📅 ${doneDate}`
    );
    return;
  }
}

async function handleCallback(cb) {
  const [action, idStr] = cb.data.split("_");
  const id = parseInt(idStr);
  const tickets = await getTickets();
  const ticket = tickets.find(t => t.id === id);
  if (!ticket) { await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "الطلب غير موجود" }); return; }

  if (action === "done") {
    const doneDate = new Date().toISOString().split("T")[0];
    await updateTicket(id, { status: "done", resolution_date: doneDate, resolution: "تمت المعالجة" });
    await sendMsg(GROUP_ID, `✅ <b>تمت معالجة ${ticket.ticket_num}</b>\n👤 ${ticket.client_name}\n📍 ${ticket.address}\n🔩 ${ticket.problem_type}\n📅 ${doneDate}`);
    await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ تم!" });
  } else if (action === "proc") {
    await updateTicket(id, { status: "processing" });
    await sendMsg(GROUP_ID, `🔄 <b>${ticket.ticket_num}</b> قيد المعالجة\n👤 ${ticket.client_name}`);
    await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "🔄 تم التحديث" });
  }
}

function formatTicket(t) {
  return `🔧 <b>${t.ticket_num}</b> | ${t.client_name}\n📱 ${t.phone} | 📍 ${t.address}\n🔩 ${t.problem_type}`;
}

// Polling
let lastUpdate = 0;
async function poll() {
  try {
    const res = await tgApi("getUpdates", { offset: lastUpdate + 1, timeout: 30 });
    if (res.ok && res.result.length) {
      for (const update of res.result) {
        lastUpdate = update.update_id;
        if (update.message) await handleMessage(update.message).catch(console.error);
        if (update.callback_query) await handleCallback(update.callback_query).catch(console.error);
      }
    }
  } catch (e) { console.error("Poll error:", e.message); }
  setTimeout(poll, 1000);
}

http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
}).listen(PORT, () => console.log(`SAV Bot running on port ${PORT}`));

console.log("🤖 SAV Bot + Supabase started!");
poll();
