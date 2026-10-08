# Misty Code POS

Point-of-sale for local shops: selling, stock, deposits/withdrawals, customer credit, reports.
Runs on free-tier Firebase + Vercel + GitHub.

## Structure
```
index.html                 Sign-in
pages/  pos, reports, withdrawals, credit, manager (.html)
css/    theme (10 palettes + dark mode), animations, particles, + one per page
js/     shared: firebase-config, utils, auth, logo, nav, connectivity, particles
        per page: index, pos, reports, withdrawals, credit, manager
api/notify-telegram.js     Serverless function that sends the Telegram alert
firestore.rules            Security rules (paste into Firebase Console and PUBLISH)
```

## Firebase setup (once)
1. Authentication → enable Email/Password; create the seller + manager users.
2. Firestore → create database; paste `firestore.rules` and **Publish**.
3. Create `users/{uid}` docs: `role` = `seller`|`manager`, `displayName`.
4. After deploying: Deposit/Withdraw → Adjust balance → set opening Float and Withdrawal cash.

## Telegram sale notifications
1. In Telegram, open **@BotFather** → `/mybots` → your bot → **API Token → Revoke current token** (if the token was ever shared anywhere), and copy the new one.
2. The manager opens the bot in Telegram and presses **Start**.
3. Get the manager's numeric chat ID: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and find `"chat":{"id":123456789,...}`.
4. Vercel → Project → Settings → Environment Variables → add:
   - `TELEGRAM_BOT_TOKEN` = the token
   - `TELEGRAM_CHAT_ID` = the numeric id
5. Redeploy. Every completed sale now sends the manager a message.

Never put the token in any file in this repo.
