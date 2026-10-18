# Q*bert (Browser-Klon)

Spielbarer Nachbau des Arcade-Klassikers von 1982 in reinem HTML/CSS/JavaScript (Canvas 2D),
ohne Bibliotheken und ohne Build-Schritt. Zum Starten `index.html` im Browser öffnen
(funktioniert auch direkt per `file://`).

## Steuerung

| Richtung | Tasten |
|---|---|
| oben-rechts | ↑ · W · E · Numpad 9 |
| oben-links | ← · A · Q · Numpad 7 |
| unten-links | ↓ · S · Y (QWERTZ) / Z · Numpad 1 |
| unten-rechts | → · D · C · Numpad 3 |

Enter/Leertaste startet, P/Esc pausiert, M schaltet den Ton um. Maus/Touch: neben Q*bert in den
gewünschten Quadranten tippen.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `js/game.js` | Spiellogik: Geometrie, Level-/Farbregeln, Figuren, Zustandsautomat, Kollisionen |
| `js/render.js` | Canvas-Darstellung (liest den Spielzustand nur) |
| `js/audio.js` | WebAudio-Synthesizer für alle Soundeffekte |
| `js/main.js` | Canvas-Skalierung, Eingabe, Fixed-Timestep-Loop, DOM-Overlays |
| `PROMPT.md` | Optimierte Spezifikation, nach der das Spiel gebaut wurde |
