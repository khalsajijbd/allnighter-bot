# 🌙 All Nighter Bot v2.0

A feature-packed Discord bot with economy, gambling, actions with GIFs, moderation, and much more.

---

## 🚀 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure `config.json`
```json
{
  "token": "YOUR_BOT_TOKEN_HERE",
  "clientId": "1496797832827371530",
  "guildId": "YOUR_SERVER_ID_HERE"
}
```
- **token** — Your bot token from [Discord Developer Portal](https://discord.com/developers/applications)
- **clientId** — Already filled: `1496797832827371530`
- **guildId** — Your Discord server's ID (right-click server → Copy Server ID)

### 3. Run the Bot
```bash
npm start
# or for development with auto-restart:
npm run dev
```

---

## 🔗 Bot Invite Link

Use this link to invite the bot to your server with all required permissions:

```
https://discord.com/api/oauth2/authorize?client_id=1496797832827371530&permissions=8&scope=bot%20applications.commands
```

> ⚠️ The `permissions=8` grants **Administrator** — recommended so the bot can kick, ban, manage channels, etc.

**Minimum required permissions (if you don't want Admin):**
- Send Messages
- Embed Links
- Use External Emojis
- Add Reactions
- Read Message History
- Manage Messages (for purge, say, announce)
- Manage Channels (for lock/unlock/slowmode)
- Kick Members
- Ban Members
- Moderate Members (timeout/warn)
- View Audit Log

---

## 📦 Commands (70+)

### 💰 Economy
| Command | Description |
|---------|-------------|
| `/balance [user]` | Check wallet + bank balance |
| `/daily` | Claim daily coins (200 + streak bonus) |
| `/weekly` | Claim weekly 2000 coin bonus |
| `/work` | Work every hour for coins |
| `/crime` | Risky crimes every 90 mins |
| `/deposit <amount>` | Deposit to bank |
| `/withdraw <amount>` | Withdraw from bank |
| `/give <user> <amount>` | Gift coins to someone |
| `/rob <user>` | Try to steal from someone |
| `/leaderboard` | Top 10 richest users |
| `/shop` | Browse the item shop |
| `/buy <item>` | Buy an item |
| `/inventory` | View your items |

### 🎰 Gambling
| Command | Description |
|---------|-------------|
| `/coinflip <heads/tails> <bet>` | 50/50 coin flip |
| `/slots <bet>` | Spin the slot machine |
| `/dice <number> <bet>` | Guess dice roll (5x win) |
| `/rps <choice> <bet>` | Rock Paper Scissors |
| `/blackjack <bet>` | Interactive Blackjack with Hit/Stand buttons |
| `/crash <bet>` | Crash multiplier game |
| `/highlow <bet>` | Higher or lower card game |
| `/roulette <red/black/green/number> <bet>` | Roulette wheel |
| `/lottery <tickets>` | Buy lottery tickets (3% win/ticket) |

### 🤗 Actions (all use GIFs!)
`/hug` `/kiss` `/slap` `/poke` `/pat` `/cry` `/dance` `/facepalm` `/highfive` `/bite` `/punch` `/wave` `/cuddle` `/boop` `/owo` `/kill` `/fight` `/marry` `/divorce`

### 📚 Study Tools
| Command | Description |
|---------|-------------|
| `/studystart <subject>` | Start tracking study time |
| `/studystop` | End session, earn coins + XP |
| `/board` | Study time leaderboard |
| `/pomodoro` | 25-minute focus timer |

### 👤 Info / Utility
`/userinfo` `/serverinfo` `/avatar` `/ping` `/afk` `/snipe` `/poll` `/calculate` `/remind` `/rank` `/xpleaderboard`

### 🛡️ Moderation
`/kick` `/ban` `/timeout` `/warn` `/warnings` `/clearwarns` `/purge` `/slowmode` `/lock` `/unlock` `/announce`

### 😂 Fun / Misc
`/meme` `/gif <query>` `/motivation` `/8ball` `/roast` `/rizz` `/funphrase` `/joke` `/fact` `/ship` `/pp` `/iq` `/simp` `/clap` `/reverse` `/say` `/topic` `/wyr` `/neverhaveiever`

---

## 🏪 Shop Items
| Item | Price | Effect |
|------|-------|--------|
| 👑 VIP Badge | 500 | Flex status |
| 🍀 Lucky Charm | 200 | +10% gambling luck |
| 🛡️ Shield | 300 | Protects from robbery |
| 🎣 Fishing Rod | 150 | Bonus income |
| 💼 Briefcase | 400 | 1.5x /work payout |
| 🔒 Padlock | 250 | Bank security |

---

## 💡 Notes
- Economy data is **stored in memory** — it resets when the bot restarts. For persistent data, add SQLite or MongoDB.
- GIFs are fetched from **Tenor API** — they're real animated GIFs, not text.
- Starting balance for all new users: **500 coins**.
- `/studystop` rewards **5 coins + 10 XP per minute** studied.
