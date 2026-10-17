# Suspect.io multiplayer prototype

Suspect.io is now an installable, mobile-first web app. Every player uses a separate phone and joins the same four-character room code. The Node server keeps roles private and coordinates the three answer rounds, voting, the mole's last guess, and the shared leaderboard.

## Run it on a computer

1. Install Node.js 20 or newer.
2. In this folder, run `npm install` once.
3. Run `npm start`.
4. Open `http://localhost:3000` to play on that computer.

For phones on the same Wi-Fi, open `http://COMPUTER-LAN-IP:3000` on each phone. The computer and phones must be allowed to communicate on that network. This HTTP address is for local testing; browser installation and public internet play need an HTTPS deployment.

## Let friends play over the internet

Deploy this folder as a Node.js web service with a public HTTPS URL. The service must keep WebSocket upgrades enabled (Socket.IO uses HTTPS/WSS and can fall back to long polling). Set the hosting provider's `PORT` environment variable if required. Rooms currently live in server memory, so deploy one server instance and expect rooms to reset when the service restarts.

When opened from the HTTPS URL, use the browser's **Add to Home Screen** / **Install app** action to add the PWA to a phone. The downloadable iOS App Store or Android Play Store build is a later packaging step; this PWA can be installed directly without either store.

## Game details

- 3–12 players per room; 2 moles at 7+ players.
- Three 10-second word rounds; an answer can be used only once per round.
- 20-second private vote and a 12-second last-gasp typed guess.
- Reconnects can resume for 60 seconds; disconnected players auto-submit blanks during the answer phase.
- The word bank is local to the server and includes the curated words plus the bundled Open English WordNet 2025 entries. See `assets/WORDLIST-SOURCE.txt`.
