# CLAUDE.md

Hinweise für Claude Code in diesem Repository.

## Projekt

Webanwendung zur Inventurerfassung für ein Uhren- und Schmuckgeschäft, betrieben als Docker-Compose-Projekt im lokalen Netzwerk.

- **[Anforderung.md](Anforderung.md)** ist die verbindliche Spezifikation. Vor jeder Umsetzung den relevanten Abschnitt lesen. Mit **(Annahme)** markierte Punkte gelten, bis der Nutzer etwas anderes entscheidet.
- **[Arbeitsschritte.md](Arbeitsschritte.md)** ist der Umsetzungsplan. Die Schritte werden der Reihe nach abgearbeitet. Ein Schritt ist erst abgeschlossen, wenn seine „Fertig, wenn“-Bedingung erfüllt ist.
- Weicht eine Umsetzung von der Spezifikation ab oder zeigt sich eine neue Unklarheit, wird der Nutzer gefragt und `Anforderung.md` danach aktualisiert. Die Spezifikation wird nicht stillschweigend übergangen.

## Tech-Stack

- TypeScript (strict) in einem pnpm-Monorepo:
  - `apps/server`: Fastify, WebSockets, PostgreSQL
  - `apps/web`: React und Vite, Routen `/` (Station), `/admin` und `/scan` (Handy)
  - `packages/shared`: gemeinsame Typen und Nachrichtenformate
- PostgreSQL 16 mit `pg_trgm`. Das Schema `stammdaten` wird nur gelesen, das Schema `inventur` gehört der Anwendung.
- Caddy als Reverse-Proxy mit interner CA (HTTPS für die Smartphone-Kamera)
- Vitest für Unit-Tests, Testcontainers für Datenbank-Integrationstests
- Der Server läuft ohne Build direkt als TypeScript (Node.js Type Stripping). Deshalb: relative Importe mit Endung `.ts`, nur löschbare Syntax (`erasableSyntaxOnly`, keine `enum`s oder Parameter-Properties). `packages/shared` wird als Quellcode importiert.
- `deploy/` enthält `docker-compose.yml`, `Caddyfile` und `.env.example`.

## Befehle

Node.js ≥ 24, pnpm. Befehle (die mit späterem Schritt markierten existieren noch nicht):

```sh
pnpm install
pnpm dev        # Server und Frontend im Entwicklungsmodus
pnpm lint       # ESLint und Prettier --check
pnpm format     # Prettier --write
pnpm typecheck  # tsc in allen Paketen
pnpm test       # Vitest in allen Paketen
pnpm seed       # Stammdaten mit Dummy-Daten befüllen (ab Schritt 4)
pnpm testblatt  # PDF mit Test-Barcodes erzeugen (ab Schritt 4a)
```

## Konventionen

- **Sprache:** Die Oberfläche, die Dokumentation und die Commit-Nachrichten sind auf Deutsch. Fachbegriffe im Code folgen dem Datenmodell der Spezifikation (z. B. `arbeitsbereich`, `erfassung`, `checkpoint`). Technische Bezeichner und Framework-Code bleiben englisch.
- **Tests:** Jede Fachlogik bekommt Unit-Tests im selben Schritt. Die Fachlogik (Statusübergänge, Suchauflösung, Mengen, Checkpoints, Tastatursteuerung) liegt in reinen, ohne Datenbank testbaren Modulen.
- **Git:** Pro Arbeitsschritt ein eigener Branch (`schritt-NN-kurzname`) und ein Pull Request. Nicht direkt auf `main` entwickeln.
- **Stammdaten** werden von der Anwendung nie geschrieben. Erfassungen speichern eine Momentaufnahme der Stammdaten.
- **Live-Aktualisierung:** Jede Änderung an Erfassungen, Bereichen, Stationen oder Mitarbeitern löst ein Ereignis über den WebSocket-Event-Bus aus.
- Keine Authentifizierung einbauen. Die Anwendung läuft nur im LAN, das Admin-Dashboard ist nur über `127.0.0.1:8080` erreichbar.
- Das Repository und die Images sind privat: `ghcr.io/oktupol/inventur-app`.
