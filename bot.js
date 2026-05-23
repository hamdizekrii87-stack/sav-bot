const TOKEN = process.env.BOT_TOKEN || "8855409722:AAHBNK3XcUcEDrh5euSXRy6mVHZ2imZFLGQ";
const GROUP_ID = process.env.GROUP_ID || "-5137002293";
const PORT = process.env.PORT || 3000;

const https = require("https");
const http = require("http");

// Simple in-memory storage for tickets
let tickets = [];
let ticketCounter = 1;
let pendingEntry = {}; // userId -> partial ticket being built

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

function sendMessage(chatId, text, extra = {}) {
  return tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

function formatTicket(t) {
  return `🔧 <b>طلب SAV جديد</b>
━━━━━━━━━━━━━━
🆔 <b>رقم الطلب:</b> SAV-${String(t.id).padStart(3,"0")}
👤 <b>الاسم:</b> ${t.name}
📱 <b>الهاتف:</b> ${t.phone}
📍 <b>العنوان:</b> ${t.address}
🔩 <b>نوع العطب:</b> ${t.problem}
📅 <b>التاريخ:</b> ${t.date}
📊 <b>الحالة:</b> جديد 🟡`;
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

  // ===== GROUP COMMANDS =====
  if (isGroup) {
    // Format: any message with these keywords triggers guided entry
    if (text.toLowerCase().includes("/sav") || text.toLowerCase().includes("/reclamation") || text === "/start") {
      await sendMessage(chatId, 
        `📋 <b>تسجيل طلب SAV جديد</b>\n\nأرسل المعلومات بهذا الشكل:\n\n<code>اسم: محمد بن علي\nهاتف: 0661234567\nعنوان: حي السلام بلوك 3\nعطب: تسرب مياه</code>\n\nأو اكتب /new لبدء الإدخال خطوة بخطوة`
      );
      return;
    }

    // Parse structured message: اسم: ... هاتف: ... عنوان: ... عطب: ...
    if (text.includes("اسم:") || text.includes("nom:")) {
      const lines = text.split("\n");
      let t = { id: ticketCounter++, date: new Date().toLocaleDateString("ar-DZ"), status: "new", chatId: GROUP_ID };
      for (const line of lines) {
        const l = line.trim();
        if (l.match(/^(اسم|nom)\s*:/i)) t.name = l.split(":").slice(1).join(":").trim();
        else if (l.match(/^(هاتف|tel|téléphone|phone)\s*:/i)) t.phone = l.split(":").slice(1).join(":").trim();
        else if (l.match(/^(عنوان|adresse|address)\s*:/i)) t.address = l.split(":").slice(1).join(":").trim();
        else if (l.match(/^(عطب|problème|probleme|panne|نوع)\s*:/i)) t.problem = l.split(":").slice(1).join(":").trim();
      }
      if (t.name && t.phone && t.address && t.problem) {
        tickets.push(t);
        const num = `SAV-${String(t.id).padStart(3,"0")}`;
        await sendMessage(chatId, `✅ <b>تم تسجيل الطلب ${num}</b>\n\n${formatTicket(t)}`);
        return;
      } else {
        await sendMessage(chatId, `⚠️ معلومات ناقصة! تأكد من إدخال:\n• اسم\n• هاتف\n• عنوان\n• عطب`);
        return;
      }
    }

    // /list - show open tickets
    if (text === "/list" || text === "/قائمة") {
      const open = tickets.filter(t => t.status !== "done" && t.status !== "closed");
      if (!open.length) { await sendMessage(chatId, "✅ لا توجد طلبات مفتوحة حالياً"); return; }
      let msg2 = `📋 <b>الطلبات المفتوحة (${open.length})</b>\n━━━━━━━━━━━━━━\n`;
      for (const t of open) {
        msg2 += `\n🔹 <b>SAV-${String(t.id).padStart(3,"0")}</b> | ${t.name} | ${t.problem} | ${t.status === "new" ? "🟡 جديد" : t.status === "processing" ? "🟠 قيد المعالجة" : "🔵 " + t.status}\n`;
      }
      await sendMessage(chatId, msg2);
      return;
    }

    // /done SAV-001 ما تم إنجازه
    if (text.startsWith("/done") || text.startsWith("/تمت")) {
      const parts = text.split(" ");
      const ticketNum = parts[1]; // SAV-001
      const resolution = parts.slice(2).join(" ");
      const id = parseInt(ticketNum?.replace(/SAV-/i, ""));
      const ticket = tickets.find(t => t.id === id);
      if (!ticket) { await sendMessage(chatId, `❌ الطلب ${ticketNum} غير موجود`); return; }
      ticket.status = "done";
      ticket.resolution = resolution || "تمت المعالجة";
      ticket.doneDate = new Date().toLocaleDateString("ar-DZ");
      await sendMessage(chatId,
        `✅ <b>تمت معالجة الطلب SAV-${String(ticket.id).padStart(3,"0")}</b>\n━━━━━━━━━━━━━━\n👤 <b>العميل:</b> ${ticket.name}\n📱 <b>الهاتف:</b> ${ticket.phone}\n📍 <b>العنوان:</b> ${ticket.address}\n🔩 <b>العطب:</b> ${ticket.problem}\n✅ <b>ما تم:</b> ${ticket.resolution}\n📅 <b>تاريخ الإنجاز:</b> ${ticket.doneDate}`
      );
      return;
    }

    return;
  }

  // ===== PRIVATE CHAT (Admin) =====
  if (text === "/start") {
    await sendMessage(chatId, `👋 <b>مرحباً بك في بوت SAV</b>\n\n/list - قائمة الطلبات\n/stats - الإحصائيات`);
    return;
  }

  if (text === "/list") {
    const open = tickets.filter(t => t.status !== "done" && t.status !== "closed");
    if (!open.length) { await sendMessage(chatId, "✅ لا توجد طلبات مفتوحة"); return; }
    for (const t of open) {
      await sendMessage(chatId, formatTicket(t), {
        reply_markup: { inline_keyboard: [[
          { text: "✅ تمت المعالجة", callback_data: `done_${t.id}` },
          { text: "🔄 قيد المعالجة", callback_data: `proc_${t.id}` }
        ]]}
      });
    }
    return;
  }

  if (text === "/stats") {
    const total = tickets.length;
    const open = tickets.filter(t => !["done","closed"].includes(t.status)).length;
    const done = tickets.filter(t => t.status === "done").length;
    await sendMessage(chatId, `📊 <b>إحصائيات SAV</b>\n━━━━━━━━━━━━━━\n📁 الإجمالي: ${total}\n🟡 المفتوحة: ${open}\n✅ المعالجة: ${done}`);
    return;
  }
}

async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  const [action, idStr] = data.split("_");
  const id = parseInt(idStr);
  const ticket = tickets.find(t => t.id === id);
  if (!ticket) { await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "الطلب غير موجود" }); return; }

  if (action === "done") {
    ticket.status = "done";
    ticket.doneDate = new Date().toLocaleDateString("ar-DZ");
    await sendMessage(GROUP_ID,
      `✅ <b>تمت معالجة الطلب SAV-${String(ticket.id).padStart(3,"0")}</b>\n━━━━━━━━━━━━━━\n👤 ${ticket.name}\n📱 ${ticket.phone}\n📍 ${ticket.address}\n🔩 ${ticket.problem}\n📅 ${ticket.doneDate}`
    );
    await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ تم الإرسال للقروب!" });
  } else if (action === "proc") {
    ticket.status = "processing";
    await sendMessage(GROUP_ID, `🔄 <b>SAV-${String(ticket.id).padStart(3,"0")}</b> قيد المعالجة الآن\n👤 ${ticket.name} | ${ticket.problem}`);
    await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "🔄 تم التحديث" });
  }
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

// Health check server
http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({ status: "ok", tickets: tickets.length, uptime: process.uptime() }));
}).listen(PORT, () => console.log(`SAV Bot running on port ${PORT}`));

console.log("🤖 SAV Bot started! Listening for messages...");
poll();
