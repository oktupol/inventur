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
- PostgreSQL 16 mit `pg_trgm`, Kysely als Query-Builder mit Migrationen in `apps/server/src/db/migrations`. Das Schema `master_data` wird nur gelesen, das Schema `inventory` gehört der Anwendung.
- Integrationstests heißen `*.int.test.ts` und laufen gegen einen Postgres-Testcontainer (`apps/server/test/`).
- Caddy als Reverse-Proxy mit interner CA (HTTPS für die Smartphone-Kamera)
- Vitest für Unit-Tests, Testcontainers für Datenbank-Integrationstests
- PDFs mit pdfmake und den PDF-Standardschriften (`apps/server/src/pdf/render.ts`), Barcodes mit bwip-js als SVG (`apps/server/src/pdf/barcode.ts`). Wird für Testblatt und Zählliste verwendet.
- Der Server läuft ohne Build direkt als TypeScript (Node.js Type Stripping). Deshalb: relative Importe mit Endung `.ts`, nur löschbare Syntax (`erasableSyntaxOnly`, keine `enum`s oder Parameter-Properties). `packages/shared` wird als Quellcode importiert.
- `deploy/` enthält `docker-compose.yml`, `Caddyfile` und `.env.example`.

## Befehle

Node.js ≥ 24, pnpm. Befehle (die mit späterem Schritt markierten existieren noch nicht):

```sh
pnpm install
pnpm db:up      # Entwicklungsdatenbank (Docker) starten
pnpm dev        # Server und Frontend im Entwicklungsmodus
pnpm lint       # ESLint und Prettier --check
pnpm format     # Prettier --write
pnpm typecheck  # tsc in allen Paketen
pnpm test       # Vitest in allen Paketen, inkl. Integrationstests (Docker)
pnpm test:unit  # nur Unit-Tests
pnpm seed       # Stammdaten mit Dummy-Daten befüllen (--count, --seed, --replace)
pnpm test-sheet --output testblatt.pdf  # PDF mit Test-Barcodes (--count, --seed)
```

## Konventionen

- **Sprache:** Nur die Oberfläche (UI-Texte) und die Markdown-Dateien sind auf Deutsch. Alles andere ist englisch: Bezeichner, Code-Kommentare, Testbeschreibungen, Datenbank (Schemas, Tabellen, Spalten, Statuswerte), CLI-Befehle, Parameter und Ausgaben, API-Fehlermeldungen, Konfigurationskommentare sowie Commit-Nachrichten und Pull Requests. Inhaltsdaten wie Dummy-Artikelbezeichnungen sind deutsch, weil sie in der Oberfläche erscheinen.
- **Glossar** (Fachbegriff der Spezifikation → Bezeichner): Inventur → `stocktake`, Stammdaten → `master_data`, Artikel → `article`, Artikelnummer → `article_number`, Bezeichnung → `description`, Mitarbeiter → `employee`, Arbeitsstation → `workstation`, Arbeitsbereich → `work_area`, Erfassung (Zeile) → `entry`, Checkpoint → `checkpoint`, Kopplung → `pairing`, Menge → `quantity`, Soll-Anzahl → `expected_quantity`, manuell → `is_manual`, Status offen/in Arbeit/abgeschlossen → `open`/`in_progress`/`closed`, Inventur aktiv/beendet → `active`/`finished`, Ergebnis grün/gelb/rot → `unique`/`ambiguous`/`not_found`.
- **Tests:** Jede Fachlogik bekommt Unit-Tests im selben Schritt. Die Fachlogik (Statusübergänge, Suchauflösung, Mengen, Checkpoints, Tastatursteuerung) liegt in reinen, ohne Datenbank testbaren Modulen.
- **Git:** Pro Arbeitsschritt ein eigener Branch (`schritt-NN-kurzname`) und ein Pull Request. Nicht direkt auf `main` entwickeln.
- **Stammdaten** werden von der Anwendung nie geschrieben. Erfassungen speichern eine Momentaufnahme der Stammdaten.
- **Live-Aktualisierung:** Jede Änderung an Erfassungen, Bereichen, Stationen oder Mitarbeitern löst ein Ereignis über den WebSocket-Event-Bus aus. Im Server per `app.events.publish(event)`. Ereignistypen und die Zuordnung zu Kanälen (`channelsForEvent`) stehen in `packages/shared/src/realtime/events.ts`. Im Frontend: `useRealtimeEvents(channels, handler)` und `useConnectionStatus()`.
- **API und Fehler:** Routen unter `/api`; alles für das Admin-Dashboard unter `/api/admin`, das Caddy auf Port 80 sperrt (wie `/admin`). Endpunkte der Stationen liegen unter `/api/station` und authentifizieren sich mit dem Header `x-workstation-token` (`authenticate` in `apps/server/src/station/service.ts`). Request- und Response-Typen in `packages/shared/src/api`. Regelverstöße werfen `DomainError` (`apps/server/src/errors.ts`) mit einem `ErrorCode` aus `packages/shared`; die Antwort ist `{ error, code, details? }`, das Frontend übersetzt den Code in deutschen Text.
- **Schreibschutz:** Jeder schreibende Zugriff auf Daten einer Inventur läuft über `withWritableStocktake` (`apps/server/src/stocktake/service.ts`), das beendete Inventuren ablehnt.
- Keine Authentifizierung einbauen. Die Anwendung läuft nur im LAN, das Admin-Dashboard ist nur über `127.0.0.1:8080` erreichbar.
- Das Repository und die Images sind privat: `ghcr.io/oktupol/inventur-app`.
