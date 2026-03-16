# Daycraft

A personal, interest-first day and week planner powered by AI. Built as a pure HTML/CSS/JS app — no framework, no install, just open `index.html` in your browser.

![Dark premium UI](https://img.shields.io/badge/UI-Dark%20Premium-c9a96e?style=flat-square) ![No backend](https://img.shields.io/badge/Backend-None-5dcaa5?style=flat-square) ![AI Powered](https://img.shields.io/badge/AI-Groq%20%2F%20Llama%203.3-9b87f5?style=flat-square)

---

## What it does

Most schedulers ask you to fill in tasks. Daycraft asks what you *love* — then builds your day around that.

- Tell it your interests (gym, coding, reading, music — anything)
- Set your mood and energy level
- Block out unavailable times
- Hit generate — AI crafts a full schedule around you

---

## Features

### Generate
- **Single day** — pick today or any future date, set start/end time, override mood & energy
- **Week (1–7 days)** — generate a multi-day schedule in one click, each day unique
- Smart fallback if no API key — rule-based schedule still uses all your preferences

### Schedule view
- Visual timeline split into Morning / Afternoon / Evening
- **Drag to reorder** any activity
- **Mark done** — progress bar tracks completion
- **Swap** — AI suggests alternatives for every block including breaks
- **+ Add custom** — add your own activity anywhere in the day
- **Edit** — change title, description, start/end time, category, color for any block
- **Regenerate** individual days without touching the rest

### Calendar
- Full monthly mini calendar
- Click any day → split view: schedule on the left, reminders on the right
- Dot indicators for days with schedules or reminders
- Per-day mood override

### Reminders
- Add reminders with title, date, time, priority (low / medium / high), color, repeat (daily / weekly / weekdays / weekends / monthly), and notes
- Filter by All / Today / High priority / Recurring

### Setup
- Save interests, recurring weekly activities (e.g. Gym on Mon/Wed/Fri), default blocked times, mood and energy
- **Export / Import** — back up all your data to a JSON file anytime

### Live clock
- Real-time Tempe, AZ clock in the nav bar (America/Phoenix timezone)

---

## Getting started

### 1. Download or clone
```bash
git clone https://github.com/YOUR_USERNAME/daycraft.git
cd daycraft
```

### 2. Open in browser
Just double-click `index.html` — no server needed.

### 3. Get a free Groq API key
1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Create a free account
3. Click **Create API Key**, copy it
4. Paste it into **Setup → Step 6** in the app

### 4. Generate your first schedule
1. Add your interests in Setup
2. Go to **Generate → Single Day**
3. Hit **Generate Day Schedule**
4. Click the result card or go to **Calendar** to see your day

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Zero dependencies, runs as a local file |
| AI | [Groq API](https://groq.com) — Llama 3.3 70B | Free tier, fast (2–3s), high quality |
| Storage | localStorage + JSON export | No backend needed, instant, private |
| Fonts | DM Serif Display + DM Sans | Clean premium pairing |

---

## File structure

```
daycraft/
├── index.html   — All pages and modals
├── style.css    — Full dark premium stylesheet
└── app.js       — All logic: Store, AI, Timeline, Setup, GenPage, CalPage, Modals
```

---

## Data & privacy

- Everything stays on **your computer** in localStorage
- Your Groq API key is stored locally and only sent to `api.groq.com`
- No analytics, no tracking, no accounts
- Use **Export backup** in Setup to save your data as a JSON file anytime

---

## Roadmap

- [ ] Firebase / Supabase backend for multi-device sync
- [ ] User accounts and login
- [ ] Browser notifications for reminders
- [ ] Mobile app (PWA)
- [ ] Weekly progress report
- [ ] Google Calendar sync

---

## License

MIT — do whatever you want with it.
