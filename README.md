# Inventur

Webanwendung zur Inventurerfassung in einem Uhren- und Schmuckgeschäft. Mehrere Arbeitsstationen im lokalen Netzwerk erfassen Artikel parallel in Arbeitsbereichen, per Barcode-Scanner, Tastatur oder Smartphone-Kamera. Ein Administrations-Dashboard steuert die Inventur, zeigt Statistiken und exportiert die Ergebnisse.

> **Status:** In Umsetzung (siehe [Arbeitsschritte.md](Arbeitsschritte.md)).

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [Anforderung.md](Anforderung.md) | Fachliche und technische Anforderungen, Datenmodell, Architektur |
| [Arbeitsschritte.md](Arbeitsschritte.md) | Umsetzungsplan in 22 aufeinander aufbauenden Schritten |
| [CLAUDE.md](CLAUDE.md) | Hinweise für die Arbeit mit Claude Code in diesem Repository |

## Funktionen im Überblick

- **Erfassung**: Suche nach EAN, Artikelnummer oder Bezeichnung; farbliche Rückmeldung (grün, gelb, rot); Mengen per Tastenkürzel oder Maus ändern; Checkpoints als Zwischensummen
- **Arbeitsbereiche**: Mehrere Stationen arbeiten gemeinsam an einem Bereich, mit Live-Aktualisierung
- **Smartphone als Scanner**: Kopplung per QR-Code oder Einmal-Code, die Kamera liest die Barcodes
- **Unbekannte Artikel**: manuelle Erfassung mit Bezeichnung, Bruttopreis und optionaler Seriennummer
- **Auswertung**: Statistiken, Soll/Ist-Abgleich gegen die Stammdaten, Export als CSV, XLSX und PDF-Zählliste

## Architektur

- Docker-Compose-Projekt mit PostgreSQL, der Anwendung (TypeScript: Fastify und React) und Caddy als Reverse-Proxy
- Das Image `ghcr.io/oktupol/inventur-app` wird per GitHub Actions gebaut und veröffentlicht.
- Die Anwendung läuft nur im lokalen Netzwerk und hat keine Authentifizierung.

| Zugang | Adresse |
|---|---|
| Arbeitsstationen | `http://<server>/` |
| Smartphones | `https://<server>/scan` |
| Admin-Dashboard (nur auf dem Server) | `http://localhost:8080` |

## Entwicklung

Voraussetzungen: Node.js 24 oder neuer und pnpm (z. B. per `npm install -g pnpm` oder `corepack enable`).

```sh
pnpm install
pnpm dev        # Server (Port 3000) und Frontend (http://localhost:5173) im Entwicklungsmodus
pnpm lint       # ESLint und Prettier-Prüfung
pnpm format     # Formatierung mit Prettier anwenden
pnpm typecheck  # TypeScript-Prüfung aller Pakete
pnpm test       # Unit-Tests aller Pakete
```

Das Frontend leitet `/api` im Entwicklungsmodus an den Server weiter. Die Routen sind `/` (Arbeitsstation), `/admin` (Dashboard) und `/scan` (Handy).

| Paket | Inhalt |
|---|---|
| `apps/server` | Fastify-Server; läuft direkt als TypeScript (Node.js Type Stripping), ohne Build-Schritt |
| `apps/web` | React-Frontend mit Vite |
| `packages/shared` | Gemeinsame Typen und Nachrichtenformate |

Das Image lässt sich lokal mit `docker build -t inventur-app .` bauen. Der Server liefert darin das gebaute Frontend aus (`STATIC_DIR`). Der Workflow `release.yml` veröffentlicht es bei jedem Push auf `main` (Tags `latest` und `sha-<kurz>`) und bei Tags `v*` für `linux/amd64` und `linux/arm64`.

## Installation

Folgt mit Schritt 22 des [Umsetzungsplans](Arbeitsschritte.md). Kurzfassung des geplanten Ablaufs auf einem Linux-Server:

```sh
# einmalig: Zugriff auf die private Container Registry (Token mit Scope read:packages)
docker login ghcr.io

# docker-compose.yml, Caddyfile und .env.example aus dem Ordner deploy/ auf den Server kopieren
# Konfiguration anlegen (PUBLIC_HOST, POSTGRES_PASSWORD, APP_VERSION)
cp .env.example .env

docker compose up -d
```

Die Stammdaten befüllt der Administrator vorab selbst in die Tabellen `stammdaten.artikel` und `stammdaten.artikelnummer`. Das Schema steht in [Anforderung.md](Anforderung.md#stammdaten).

Zum Testen lassen sich die Stammdaten stattdessen mit Dummy-Daten befüllen:

```sh
docker compose run --rm app seed-stammdaten --anzahl 5000 --seed 42
```

Ein druckbares PDF mit Test-Barcodes, mit einem Abschnitt je Erfassungsfall (grün, gelb, rot), erzeugt:

```sh
docker compose run --rm -v "$PWD:/out" app barcode-testblatt --ausgabe /out/testblatt.pdf
```
