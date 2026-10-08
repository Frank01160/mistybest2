// ============================================================================
// /api/notify-telegram — Vercel serverless function
// ----------------------------------------------------------------------------
// Sends a Telegram message to the manager. The bot token and chat ID live in
// Vercel Environment Variables (NEVER in this file or in the front-end code):
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — the manager's numeric chat ID
// ============================================================================

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const message = req.body && req.body.message;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(500).json({ error: "Telegram is not configured on the server" });
  }

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 3500) }),
    });
    const data = await tgRes.json();
    if (!data.ok) {
      return res.status(502).json({ error: "Telegram API error", details: data.description });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send", details: String(err) });
  }
};
