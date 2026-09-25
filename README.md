# Inventur

Webanwendung zur Inventurerfassung in einem Uhren- und Schmuckgeschäft. Mehrere Arbeitsstationen im lokalen Netzwerk erfassen Artikel parallel in Arbeitsbereichen, per Barcode-Scanner, Tastatur oder Smartphone-Kamera. Ein Administrations-Dashboard steuert die Inventur, zeigt Statistiken und exportiert die Ergebnisse.

> **Version 1.1.** Die Installation beschreibt der Abschnitt [Installation](#installation), den Ablauf einer Inventur der Abschnitt [Ablauf einer Inventur](#ablauf-einer-inventur).

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [Anforderung.md](Anforderung.md) | Fachliche und technische Anforderungen, Datenmodell, Architektur |
| [Arbeitsschritte.md](Arbeitsschritte.md) | Umsetzungsplan in 22 aufeinander aufbauenden Schritten |
| [Probedurchlauf.md](Probedurchlauf.md) | Checkliste für einen vollständigen Testlauf vor dem Einsatz |
| [CLAUDE.md](CLAUDE.md) | Hinweise für die Arbeit mit Claude Code in diesem Repository |

## Funktionen im Überblick

- **Erfassung**: Suche nach EAN, Artikelnummer oder Bezeichnung; farbliche Rückmeldung (grün, gelb, rot); Mengen per Tastenkürzel oder Maus ändern; Checkpoints als Zwischensummen
- **Arbeitsbereiche**: Mehrere Stationen arbeiten gemeinsam an einem Bereich, mit Live-Aktualisierung
- **Smartphone als Scanner**: Kopplung per QR-Code oder Einmal-Code, die Kamera liest die Barcodes
- **Unbekannte Artikel**: manuelle Erfassung mit Bezeichnung, Bruttopreis und optionaler Seriennummer
- **Seriennummern**: an jeder Zeile nachtragen, z. B. für Uhren, auch per Scan oder am Handy
- **Auswertung**: Statistiken, Soll/Ist-Abgleich gegen die Stammdaten, Export als CSV, XLSX und PDF-Zählliste
- **Nachvollziehbarkeit**: Änderungsprotokoll aller Mengenänderungen und Löschungen mit Station und Mitarbeitern

## Architektur

- Docker-Compose-Projekt mit PostgreSQL, der Anwendung (TypeScript: Fastify und React) und Caddy als Reverse-Proxy
- Das Image `ghcr.io/oktupol/inventur-app` wird per GitHub Actions gebaut und veröffentlicht.
- Die Anwendung läuft nur im lokalen Netzwerk und hat keine Authentifizierung.

| Zugang | Adresse |
|---|---|
| Arbeitsstationen | `http://<server>/` |
| Smartphones | `https://<server>/scan` (vorher einmalig das Zertifikat installieren: `http://<server>/zertifikat`) |
| Admin-Dashboard (nur auf dem Server) | `http://localhost:8080` |

## Installation

### Voraussetzungen

- Ein Rechner im lokalen Netzwerk als Server, mit Linux (x86-64 oder ARM64, z. B. Raspberry Pi 4/5) und Docker mit dem Compose-Plugin (`docker compose version` muss funktionieren)
- Eine **feste IP-Adresse** für den Server, z. B. per DHCP-Reservierung im Router. QR-Codes und das HTTPS-Zertifikat für die Smartphones werden auf diese Adresse ausgestellt.
- Die Ports 80 und 443 des Servers sind aus dem LAN erreichbar (Firewall).
- Arbeitsstationen: beliebige Rechner mit aktuellem Chrome, Edge oder Firefox. Smartphones: Safari (iOS) oder Chrome (Android), im selben WLAN.

### 1. Zugriff auf die Container Registry

Das Image `ghcr.io/oktupol/inventur-app` ist privat. Der Server braucht deshalb einmalig einen Zugang:

1. Auf GitHub mit einem Konto anmelden, das Zugriff auf das Repository [`oktupol/inventur`](https://github.com/oktupol/inventur) hat.
2. *Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)*
3. Eine Bezeichnung vergeben (z. B. „Inventur-Server“), eine Ablaufzeit wählen und **nur** den Scope `read:packages` ankreuzen. Token erzeugen und kopieren; GitHub zeigt es nur einmal an.
4. Auf dem Server anmelden (Benutzername ist der GitHub-Benutzername, als Passwort das Token einfügen):

   ```sh
   docker login ghcr.io -u <github-benutzername>
   ```

Docker speichert den Zugang, die Anmeldung ist nur einmal nötig. Läuft das Token ab, wiederholt man die Schritte.

### 2. Dateien bereitstellen

Auf dem Server einen Ordner anlegen, z. B. `/opt/inventur`, und die drei Dateien aus dem Ordner [`deploy/`](deploy/) des Repositorys hineinkopieren (auf GitHub: Datei öffnen → *Download raw file*):

| Datei | Inhalt |
|---|---|
| `docker-compose.yml` | Dienste `db` (PostgreSQL), `app` (Anwendung) und `proxy` (Caddy) |
| `Caddyfile` | Reverse-Proxy: HTTP für Stationen, HTTPS für Smartphones, Admin-Port |
| `.env.example` | Vorlage für die Konfiguration |

### 3. Konfiguration

```sh
cd /opt/inventur
cp .env.example .env
nano .env
```

| Variable | Bedeutung |
|---|---|
| `PUBLIC_HOST` | IP-Adresse (oder Hostname) des Servers im LAN, z. B. `192.168.1.10` |
| `POSTGRES_PASSWORD` | Langes, zufälliges Passwort für die Datenbank, z. B. aus `openssl rand -base64 24` |
| `APP_VERSION` | Version der Anwendung, z. B. `v1.1.0` (Standard in der Vorlage) |
| `TZ` | Zeitzone für Zeitpunkte in Exporten und PDFs, Standard `Europe/Berlin` |

Das Datenbank-Passwort wird beim ersten Start festgelegt. Eine spätere Änderung in der `.env` ändert das Passwort in der Datenbank nicht.

### 4. Starten

```sh
docker compose up -d
docker compose ps        # alle Dienste laufen, app ist „healthy“
```

Die Anwendung legt beim Start die Tabellen an bzw. aktualisiert sie. Danach sind erreichbar:

| Zugang | Adresse |
|---|---|
| Admin-Dashboard (nur direkt auf dem Server) | `http://localhost:8080` |
| Arbeitsstationen | `http://<PUBLIC_HOST>/` |
| Smartphones | `https://<PUBLIC_HOST>/scan` |
| Anleitung zur Zertifikatsinstallation | `http://<PUBLIC_HOST>/zertifikat` |

Das Admin-Dashboard ist absichtlich nur auf dem Server selbst erreichbar. Von einem anderen Rechner aus geht es per SSH-Tunnel: `ssh -L 8080:localhost:8080 <benutzer>@<server>` und dann `http://localhost:8080` im eigenen Browser.

### Aktualisieren

In der `.env` die neue `APP_VERSION` eintragen, dann:

```sh
docker compose pull
docker compose up -d
```

Die Datenbank wird beim Start automatisch migriert. Die installierte Version zeigt `curl -s http://localhost:8080/api/health`.

### Datensicherung

Die Anwendung sichert keine Daten. Eine Sicherung der gesamten Datenbank (Stammdaten und alle Inventuren) erstellt:

```sh
docker compose exec -T db pg_dump -U inventur -d inventur --format=custom > inventur-$(date +%F).dump
```

Wiederherstellen in eine leere Datenbank: `docker compose exec -T db pg_restore -U inventur -d inventur --clean --if-exists < inventur-JJJJ-MM-TT.dump`. Die Volumes `caddy-data` (Zertifikate der Handys) und `db-data` nicht löschen, auch nicht mit `docker compose down -v`.

## Stammdaten befüllen

Die Anwendung liest die Stammdaten nur, befüllt werden sie vom Administrator in zwei Tabellen der Datenbank:

- `master_data.article`: `id`, `description` (Bezeichnung), `ean` (optional), `price_net`, `price_gross`, `category` (optional), `expected_quantity` (Soll-Anzahl, optional)
- `master_data.article_number`: `article_id`, `number` (0 bis n Artikelnummern je Artikel)

Das vollständige Schema steht in [Anforderung.md](Anforderung.md#stammdaten). Die **Soll-Anzahl** ist die Stückzahl laut Warenwirtschaft: bei Schmuck und Uhren meist 1, bei Kleinteilen wie Batterien auch mehr. Artikel ohne Soll-Anzahl (`NULL`) werden im Soll/Ist-Abgleich nicht berücksichtigt. Wird ein Artikel im selben Arbeitsbereich erneut erfasst, weisen Station und Handy mit einem Hinweis und zwei kurzen Pieptönen darauf hin (Doppelscan); bei Artikeln mit Soll-Anzahl 1 auch über Bereiche hinweg.

> **Wichtig:** Als `id` die feste Artikel-ID aus der Warenwirtschaft verwenden. Der Soll/Ist-Abgleich vergleicht die Erfassungen über diese ID mit den aktuellen Stammdaten. Werden die Stammdaten neu geladen, müssen dieselben Artikel dieselbe ID behalten.

Die Datenbank ist auf dem Server unter `127.0.0.1:5432` erreichbar (Datenbank und Benutzer `inventur`, Passwort aus der `.env`), z. B. für DBeaver, pgAdmin oder ein ETL-Werkzeug. Alternativ direkt mit `psql` im Container:

```sh
docker compose exec db psql -U inventur -d inventur
```

### SQL-Beispiel

```sql
BEGIN;
-- Vorhandene Stammdaten ersetzen (Artikelnummern werden mitgelöscht).
TRUNCATE master_data.article CASCADE;

INSERT INTO master_data.article (id, description, ean, price_net, price_gross, category, expected_quantity) VALUES
  (1001, 'Herrenuhr Automatik Edelstahl, 40 mm', '4006381333931', 840.34, 1000.00, 'Armbanduhren', 1),
  (1002, 'Solitärring Weißgold 750, Brillant 0,25 ct, Gr. 54', NULL, 1512.61, 1800.00, 'Ringe', 1),
  (1003, 'Uhrenarmband Leder, 20 mm, braun', '4012345678901', 25.13, 29.90, 'Zubehör', 12);

INSERT INTO master_data.article_number (article_id, number) VALUES
  (1001, 'HU-4711'),
  (1002, 'R-0815'),
  (1002, 'LF-99812');
COMMIT;
```

Preise mit Punkt als Dezimaltrenner. EAN und Artikelnummern dürfen mehrfach vorkommen; bei der Erfassung wählt man dann den richtigen Artikel aus (gelb).

### Import aus CSV-Dateien

Mit `\copy` lassen sich CSV-Dateien direkt laden. Die Spalten müssen in der angegebenen Reihenfolge stehen, Preise mit Punkt als Dezimaltrenner, leere Felder werden zu `NULL`:

```sh
# artikel.csv: id;description;ean;price_net;price_gross;category;expected_quantity
docker compose exec -T db psql -U inventur -d inventur -c "\copy master_data.article (id, description, ean, price_net, price_gross, category, expected_quantity) FROM STDIN WITH (FORMAT csv, HEADER true, DELIMITER ';')" < artikel.csv

# artikelnummern.csv: article_id;number
docker compose exec -T db psql -U inventur -d inventur -c "\copy master_data.article_number (article_id, number) FROM STDIN WITH (FORMAT csv, HEADER true, DELIMITER ';')" < artikelnummern.csv
```

Die Stammdaten dürfen auch während einer Inventur aktualisiert werden. Jede Erfassung speichert eine Momentaufnahme von Bezeichnung, Preisen und Kategorie.

### Dummy-Daten und Barcode-Testblatt

Zum Ausprobieren lassen sich die Stammdaten mit realistischen Dummy-Daten befüllen (`--replace` ersetzt vorhandene Stammdaten, ohne bricht der Befehl bei vorhandenen Daten ab):

```sh
docker compose run --rm app seed-master-data --count 5000 --seed 42
```

Ein druckbares PDF mit Test-Barcodes, mit einem Abschnitt je Erfassungsfall (grün, gelb, rot), erzeugt:

```sh
docker compose run --rm -v "$PWD:/out" app barcode-test-sheet --output /out/testblatt.pdf
```

Das eingebundene Verzeichnis muss für den Container-Benutzer `node` (UID 1000) beschreibbar sein. Das Blatt in Originalgröße drucken (100 %, nicht „An Seite anpassen“), damit die EAN-Barcodes die Nenngröße haben. Das Testblatt funktioniert auch mit echten Stammdaten.

## Barcode-Scanner einrichten

Handscanner arbeiten wie eine Tastatur: Sie tippen den Code in das Eingabefeld der Station und drücken Enter. Die meisten USB- und Bluetooth-Scanner lassen sich über Konfigurations-Barcodes im Handbuch einstellen:

- **Modus:** USB-HID bzw. Tastatur-Emulation (nicht „Virtual COM“)
- **Tastaturlayout: Deutsch (QWERTZ).** Mit dem US-Layout werden z. B. `Y` und `Z` vertauscht und `-` falsch übertragen, Artikelnummern werden dann nicht gefunden.
- **Suffix: Enter** (CR bzw. „Carriage Return“), kein Präfix
- **Symbologien:** mindestens EAN-13, EAN-8, UPC-A/E und Code 128 (für Artikelnummern), bei Bedarf Code 39

Zum Test das Barcode-Testblatt scannen: Jedes Etikett zeigt das erwartete Ergebnis. Schnelle Scan-Folgen sind kein Problem, die Station verarbeitet sie der Reihe nach.

## Smartphones als Scanner

Smartphones brauchen HTTPS für die Kamera. Deshalb muss jedes Handy **einmalig** dem Zertifikat des Servers vertrauen:

1. Auf dem Handy `http://<PUBLIC_HOST>/zertifikat` öffnen (die Station zeigt dafür beim Koppeln auch einen QR-Code).
2. Der bebilderten Anleitung für iOS oder Android folgen und das Zertifikat installieren. Unter iOS zusätzlich *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* das Vertrauen einschalten.

Alternativ kann man die Zertifikatswarnung des Browsers einmalig bestätigen.

Koppeln:

1. An der Station in der Seitenleiste **Handy koppeln** klicken.
2. Mit der Kamera-App des Handys den QR-Code scannen, oder `https://<PUBLIC_HOST>/scan` öffnen und den sechsstelligen Code eingeben. Beides gilt 5 Minuten und nur einmal.
3. Die Station zeigt „Handy verbunden“. Auf dem Handy **Kamera starten** und den Kamerazugriff erlauben.

Standardmäßig scannt das Handy nur, solange man **Zum Scannen halten** gedrückt hält, und liest pro Druck einen Code. Gelesen wird nur der Barcode im Rahmen in der Bildmitte. Über den Modus-Schalter lässt sich dauerhaftes Scannen einstellen. Das Ergebnis erscheint auf dem Handy und an der Station; bei grün lassen sich Menge und Zeile direkt auf dem Handy ändern oder löschen, bei gelb wählt man den Artikel auf dem Handy aus, bei rot erfasst man den Artikel an der Station manuell. Mehrere Handys pro Station sind möglich. Die Kopplung bleibt bis zum Trennen oder bis zum Ende der Inventur bestehen, auch beim Neuladen der Seite.

## Ablauf einer Inventur

**Vorbereitung**

1. Stammdaten laden (siehe oben) und mit dem Barcode-Testblatt die Scanner und Handys prüfen.
2. Im Admin-Dashboard unter **Inventur** eine neue Inventur starten, z. B. „Inventur 2026“. Es kann immer nur eine Inventur aktiv sein.
3. Unter **Mitarbeiter** die Zähler anlegen und unter **Arbeitsbereiche** die Zählbereiche, z. B. „Vitrine 1“ oder „Lager Uhren“. Beides lässt sich mit **Aus letzter Inventur übernehmen** kopieren.

**An den Arbeitsstationen**

1. `http://<PUBLIC_HOST>/` öffnen. Beim ersten Mal die Station mit einem Namen **registrieren** (z. B. „Kasse“). Sind die Browserdaten verloren, übernimmt man die Station über **Bestehende Station übernehmen**.
2. Unter **Mitarbeiter anmelden** die Personen an der Station anmelden. Ein Mitarbeiter kann nur an einer Station angemeldet sein.
3. Einem **Arbeitsbereich beitreten**. Mehrere Stationen können im selben Bereich zählen; die Liste aktualisiert sich live.
4. Artikel scannen oder EAN, Artikelnummer bzw. Bezeichnung tippen und mit Enter bestätigen:
   - **Grün:** erfasst.
   - **Gelb:** mehrere Treffer; mit den Pfeiltasten und Enter oder per Maus den richtigen Artikel wählen, `Esc` bricht ab.
   - **Rot:** unbekannt, mit Ton. Mit **Manuell erfassen** (`F2`) Bezeichnung, Bruttopreis und optional Seriennummer eingeben.
5. Nach einem Regal oder Fach einen **Checkpoint** setzen (`F3`). Er bildet eine Zwischensumme, die man mit der gezählten Ware vergleichen kann.
6. Ist der Bereich fertig, **Abschließen** und in der Sicherheitsabfrage die Stückzahl prüfen. Die Station verlässt den Bereich und kann dem nächsten beitreten. Ein abgeschlossener Bereich lässt sich wieder öffnen.

Tastenkürzel an der Station, wenn das Eingabefeld leer ist (auch auf dem Nummernblock):

| Taste | Wirkung |
|---|---|
| `+` / `-` | Menge der ausgewählten Zeile erhöhen / verringern |
| `=` oder `*`, Ziffern, `Enter` | Menge setzen, z. B. `* 20 Enter` |
| `Entf` | Ausgewählte Zeile löschen (ohne Rückfrage) |
| `Strg+Z` | Zuletzt gelöschte Zeile wiederherstellen (10 Sekunden lang, auch per Button im Hinweis) |
| `↑` / `↓` | Andere Zeile auswählen; standardmäßig ist es die zuletzt an dieser Station erfasste |
| `Esc` | Auswahl zurücksetzen |
| `Tab` | Vorgeschlagene Ergänzung übernehmen (bei Texteingabe) |
| `F2` | Manuell erfassen (jederzeit) |
| `F3` | Checkpoint setzen |
| `F4` | Seriennummer der ausgewählten Zeile eingeben oder scannen, `Enter` übernimmt, `Esc` bricht ab (auch per Stift in der Spalte Seriennummer) |

**Auswertung und Abschluss**

1. Im Dashboard unter **Statistik** den Fortschritt verfolgen und den **Soll/Ist-Abgleich** prüfen: Fehlbestand (weniger erfasst als die Soll-Anzahl) und Mehrbestand (mehr erfasst als die Soll-Anzahl, manuell erfasste oder nicht mehr in den Stammdaten stehende Artikel). Auffällige Bereiche wieder öffnen und nachzählen.
2. Unter **Inventur → Export** je Bereich die **Zählliste** als PDF drucken und von Zählern und Verantwortlichem unterschreiben lassen. Dort gibt es auch die Einzelzeilen, die Liste je Artikel und den Soll/Ist-Abgleich als CSV (für Excel mit deutschen Einstellungen) und XLSX.
3. **Inventur beenden.** Offene Bereiche werden in einer Warnung aufgelistet. Danach ist die Inventur schreibgeschützt, alle Stationen zeigen „Keine aktive Inventur“, und alle Handys werden getrennt.
4. Frühere Inventuren bleiben unter **Historie** mit Statistik, Änderungsprotokoll und Exporten erhalten.

Unter **Protokoll** stehen alle nachträglichen Änderungen an Erfassungen: Mengenänderungen und gelöschte Zeilen mit Zeitpunkt, Station (oder Handy) und angemeldeten Mitarbeitern. Das Protokoll lässt sich nach Bereich, Station und Aktion filtern und als CSV oder XLSX exportieren.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Station zeigt „Verbindung getrennt“ | Netzwerk und Server prüfen (`docker compose ps`). Die Station verbindet sich automatisch neu; bis dahin ist die Eingabe gesperrt, damit kein Scan verloren geht. |
| Scanner tippt falsche Zeichen (`Y`/`Z` vertauscht) | Tastaturlayout des Scanners auf Deutsch stellen. |
| Scan wird nicht bestätigt | Suffix Enter im Scanner einstellen; prüfen, ob der Cursor im Eingabefeld steht. |
| Handy: Kamera startet nicht | Seite über `https://` öffnen und das Zertifikat installieren bzw. ihm vertrauen (iOS: Zertifikatsvertrauenseinstellungen). Kamerazugriff für den Browser erlauben. |
| Handy: QR-Code führt ins Leere | `PUBLIC_HOST` in der `.env` muss die Adresse sein, unter der die Handys den Server erreichen. Nach einer Änderung `docker compose up -d`. |
| Admin-Dashboard von einem anderen Rechner | Absichtlich gesperrt; SSH-Tunnel verwenden (siehe [Starten](#4-starten)). |
| `docker compose pull` meldet „denied“ | `docker login ghcr.io` wiederholen; das Token braucht den Scope `read:packages` und darf nicht abgelaufen sein. |

Die Protokolle der Anwendung zeigt `docker compose logs -f app`.

## Entwicklung

Voraussetzungen: Node.js 24.2 oder neuer, pnpm (z. B. per `npm install -g pnpm`) und Docker (für die Entwicklungsdatenbank und die Integrationstests).

```sh
pnpm install
pnpm db:up      # Postgres für die Entwicklung starten (127.0.0.1:54329)
pnpm seed --count 5000 --seed 42   # Stammdaten mit Dummy-Daten befüllen (--replace ersetzt vorhandene)
pnpm test-sheet --output testblatt.pdf   # Barcode-Testblatt aus den aktuellen Stammdaten (--count, --seed)
pnpm dev        # Server (Port 3000) und Frontend (http://localhost:5173) im Entwicklungsmodus
pnpm lint       # ESLint und Prettier-Prüfung
pnpm format     # Formatierung mit Prettier anwenden
pnpm typecheck  # TypeScript-Prüfung aller Pakete
pnpm test       # Unit- und Integrationstests aller Pakete (Integrationstests brauchen Docker)
pnpm test:unit  # nur Unit-Tests
pnpm db:down    # Entwicklungsdatenbank stoppen (Daten bleiben im Volume erhalten)
```

Der Server migriert die Datenbank beim Start automatisch. Die Verbindungsdaten für die Entwicklung stehen in `apps/server/dev.env`. Gesetzte Umgebungsvariablen (`DATABASE_URL` oder `PGHOST`, `PGUSER` usw.) haben Vorrang.

Das Frontend leitet `/api` im Entwicklungsmodus an den Server weiter. Die Routen sind `/` (Arbeitsstation), `/admin` (Dashboard) und `/scan` (Handy).

| Paket | Inhalt |
|---|---|
| `apps/server` | Fastify-Server; läuft direkt als TypeScript (Node.js Type Stripping), ohne Build-Schritt |
| `apps/web` | React-Frontend mit Vite |
| `packages/shared` | Gemeinsame Typen und Nachrichtenformate |

Das Image lässt sich lokal mit `docker build -t inventur-app .` bauen. Der Server liefert darin das gebaute Frontend aus (`STATIC_DIR`). Der Workflow `release.yml` veröffentlicht es bei jedem Push auf `main` (Tags `latest` und `sha-<kurz>`) und bei Tags `v*` für `linux/amd64` und `linux/arm64`.
