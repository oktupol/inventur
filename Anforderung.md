# Inventur-Erfassung

Ziel ist, eine Webanwendung zu schaffen, die zur Inventurerfassung in einem Uhren- und Schmuckgeschäft verwendet werden kann.

> Legende: Abschnitte ohne Markierung sind abgestimmte Anforderungen. **(Annahme)** kennzeichnet sinnvolle Standardentscheidungen, die ohne Rückmeldung so umgesetzt werden.

## Begriffe

| Begriff | Bedeutung |
|---|---|
| Inventur | Ein Zählvorgang von Start bis Ende. Es gibt höchstens eine aktive Inventur gleichzeitig. |
| Arbeitsstation | Ein Browser auf einem Rechner im LAN, der unter einem Namen registriert ist. |
| Mitarbeiter | Eine Person, die an einer Inventur mitzählt (nur Name, keine Anmeldung). |
| Arbeitsbereich | Ein physischer Zählbereich, z. B. „Vitrine 3“ oder „Lager Uhren“. |
| Erfassung (Zeile) | Ein erfasster Artikel mit Menge in einem Arbeitsbereich. **Jeder Scan erzeugt eine neue Zeile**, auch beim selben Artikel. |
| Kopplung | Die Verbindung eines Smartphones als Kamera-Scanner mit einer Arbeitsstation. |
| Checkpoint | Eine Markierung in der Erfassungsliste eines Arbeitsbereichs, die eine Zwischensumme bildet. |

## Stammdaten

Die Stammdaten werden vom Administrator in eine Postgres-Datenbank abgelegt. Die Postgres-Datenbank soll für die Stammdaten folgende Informationen beinhalten:

    - Bezeichnung
    - EAN
    - Preis (brutto und netto)
    - Kategorie
    - 0-n Artikelnummern

Die Stammdaten können aus verschiedenen Quellen kommen. Die Anwendung gibt deshalb **feste Zieltabellen** vor, und der Administrator ist dafür verantwortlich, sie im Vorfeld zu befüllen (per SQL, ETL-Tool o. ä.). Die Anwendung liest die Stammdaten nur und ändert sie nie.

Jeder Stammdatensatz ist ein **Einzelstück**, d. h. ein physischer Artikel mit eigener EAN oder Artikelnummer. Die Menge pro Zeile bleibt trotzdem änderbar, z. B. für Kleinteile wie Batterien oder Armbänder.

### Schema `master_data` (Annahme)

Datenbank, Code und Kommandozeile verwenden englische Bezeichner (siehe [Datenmodell](#datenmodell-der-anwendung-schema-inventory-annahme)).

```sql
CREATE TABLE master_data.article (
    id           BIGSERIAL PRIMARY KEY,
    description  TEXT          NOT NULL,   -- Bezeichnung
    ean          TEXT          NULL,       -- optional, nicht eindeutig erzwungen
    price_net    NUMERIC(12,2) NOT NULL,   -- Preis netto
    price_gross  NUMERIC(12,2) NOT NULL,   -- Preis brutto
    category     TEXT          NULL        -- flache Kategorie, keine Hierarchie
);

CREATE TABLE master_data.article_number (
    article_id  BIGINT NOT NULL REFERENCES master_data.article(id) ON DELETE CASCADE,
    number      TEXT   NOT NULL,           -- Artikelnummer
    PRIMARY KEY (article_id, number)
);
```

- Das Schema wird von der Anwendung beim Start per Migration angelegt. Der Administrator befüllt nur die Tabellen.
- Die Suchindizes (z. B. `pg_trgm` auf Bezeichnung, Indizes auf EAN und Artikelnummer) legt ebenfalls die Anwendung an.
- EAN und Artikelnummern sind nicht zwingend eindeutig. Mehrdeutigkeiten werden bei der Erfassung aufgelöst (Fall „gelb“).
- Währung ist EUR. **(Annahme)**
- Die Stammdaten dürfen sich während einer Inventur ändern. Jede Erfassung speichert deshalb eine **Momentaufnahme** von Bezeichnung, EAN, Kategorie und Preisen zum Zeitpunkt der Erfassung, damit das Inventurergebnis stabil bleibt. **(Annahme)**
- Der Postgres-Port wird nur auf `127.0.0.1` des Host-Rechners veröffentlicht, damit der Administrator die Daten mit eigenen Werkzeugen befüllen kann. **(Annahme)**

### Dummy-Daten für Testzwecke

Für Tests, Entwicklung und Vorführungen lassen sich die Stammdaten automatisiert mit Dummy-Daten befüllen.

- Aufruf als Kommandozeilenbefehl im App-Container, z. B. `docker compose run --rm app seed-master-data --count 5000`. In der Entwicklung gibt es dafür `pnpm seed`. **(Annahme)**
- Parameter **(Annahme)**:
  - `--count <n>`: Anzahl der Artikel, Standard 5.000
  - `--seed <zahl>`: Startwert für den Zufallsgenerator. Mit demselben Startwert entstehen dieselben Daten, damit Tests reproduzierbar sind. Ohne Angabe wird ein zufälliger Startwert gewählt und ausgegeben.
  - `--replace`: Leert die Stammdaten vorher. Ohne diesen Parameter bricht der Befehl ab, wenn schon Stammdaten vorhanden sind. So werden echte Stammdaten nicht versehentlich vermischt.
- Die Daten sollen realistisch sein und alle Fälle der Erfassung abdecken **(Annahme)**:
  - Bezeichnungen aus Kategorien eines Uhren- und Schmuckgeschäfts (z. B. Armbanduhren, Ringe, Ketten, Ohrschmuck, Armbänder, Zubehör), mit Marke, Material und Variante
  - Gültige EAN-13 mit korrekter Prüfziffer, damit echte Barcode-Scanner und die Handy-Kamera sie lesen können
  - Ein Teil der Artikel hat keine EAN.
  - 0 bis 3 Artikelnummern je Artikel
  - Nettopreise zwischen 5 € und 15.000 €; Bruttopreis = Netto × 1,19, kaufmännisch gerundet
  - Einige absichtlich doppelte EANs und Artikelnummern sowie ähnliche Bezeichnungen, damit der Fall „gelb“ (mehrdeutig) testbar ist
- Die Dummy-Daten werden über dieselben Tabellen eingespielt wie echte Stammdaten. Die Anwendung behandelt sie nicht anders.
- Die Integrationstests verwenden denselben Generator mit festem Startwert.

### Barcode-Testblatt

Um Barcode-Scanner und die Handy-Kamera ohne echte Ware zu testen, erzeugt ein Befehl ein druckbares PDF mit Barcodes.

- Aufruf, z. B.: `docker compose run --rm -v "$PWD:/out" app barcode-test-sheet --output /out/testblatt.pdf`. In der Entwicklung gibt es dafür `pnpm test-sheet`. **(Annahme)**
- Das Blatt liest die **aktuell vorhandenen Stammdaten** aus der Datenbank. Es funktioniert also mit Dummy-Daten und mit echten Daten.
- Parameter **(Annahme)**:
  - `--count <n>`: Anzahl der Etiketten je Abschnitt, Standard 12
  - `--seed <zahl>`: Startwert für die Auswahl der Artikel, damit das Blatt wiederholbar ist
  - `--output <pfad>`: Zieldatei
- Die Abschnitte decken alle Fälle der Erfassung ab. Zu jedem Etikett steht das erwartete Ergebnis auf dem Blatt **(Annahme)**:
  1. **Eindeutig per EAN** (EAN-13), erwartet grün
  2. **Eindeutig per Artikelnummer** (Code 128), für Artikel ohne EAN, erwartet grün
  3. **Mehrdeutig**: doppelte EAN oder Artikelnummer, erwartet gelb
  4. **Unbekannt**: gültige EAN-13, die in den Stammdaten nicht vorkommt, erwartet rot
- Jedes Etikett zeigt den Barcode, den Code im Klartext, die Bezeichnung, den Bruttopreis und das erwartete Ergebnis.
- Format: A4 als Etikettenraster. Die Barcodes werden groß genug gedruckt, dass Handscanner und Handykameras sie zuverlässig lesen (EAN-13 mindestens in Nenngröße, ca. 37 × 26 mm, mit Ruhezonen). **(Annahme)**
- Fehlt ein Abschnitt in den Stammdaten (z. B. keine Dubletten bei echten Daten), wird er mit einem Hinweis ausgelassen.

## Architektur

Die Anwendung soll als docker-compose Projekt laufen. Die Software soll in einem Mono-Repository auf Github liegen. Selbst entwickelte Software-Komponenten werden in der Github Container Registry veröffentlicht, sodass man nur mit dem Docker-Compose-File die Anwendung von jedem Computer aus starten kann. Die Anwendung wird nicht aus dem Internet erreichbar sein. Eine Authentifizierung ist nicht notwendig, auch nicht für den Administrator.

Das Repository ist angelegt ([`oktupol/inventur`](https://github.com/oktupol/inventur)). Die Workflow-Files, die die Images erstellen und veröffentlichen, müssen noch erstellt werden.

Die Funktionalität wird mit Unit-Tests abgedeckt.

Es gibt keine Vorgaben bezüglich Programmiersprachen und Frameworks.

### Technologie-Vorschlag (Annahme)

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript (Frontend und Backend) | Gemeinsame Typen für API und WebSocket-Nachrichten |
| Backend | Node.js mit Fastify, WebSockets | Leichtgewichtig, Live-Updates für Listen und Handy-Kopplung |
| Frontend | React und Vite | Stationsansicht, Admin-Dashboard und Handy-Scanner als eine SPA mit getrennten Routen |
| Datenbank | PostgreSQL 16 mit `pg_trgm` | Vorgabe; Trigramm-Index für schnelle Freitextsuche |
| Barcode (Handy) | `BarcodeDetector`-API mit ZXing als Fallback | Läuft im Browser, keine App-Installation |
| Reverse-Proxy | Caddy mit interner CA | HTTPS im LAN ohne Internet (siehe unten) |
| Tests | Vitest (Unit), Testcontainers (DB-Integration) | |
| Export | CSV, XLSX (z. B. ExcelJS), PDF (z. B. pdfmake) | |

### Compose-Dienste

| Dienst | Image | Ports |
|---|---|---|
| `db` | `postgres:16` | `127.0.0.1:5432` |
| `app` | `ghcr.io/oktupol/inventur-app` (eigenes Image: API und ausgeliefertes Frontend) | nur intern |
| `proxy` | `caddy:2` | `80` (HTTP, Arbeitsstationen), `443` (HTTPS, Smartphones), `127.0.0.1:8080` (Admin-Dashboard) |

- Volumes für die Postgres-Daten und die Caddy-Daten (die CA muss Neustarts überleben).
- Konfiguration per `.env`: `PUBLIC_HOST` (IP oder Hostname des Servers im LAN, wird für QR-Codes und das Zertifikat benötigt) und `POSTGRES_PASSWORD`.
- Der Server sollte eine feste IP haben (z. B. per DHCP-Reservierung), da QR-Codes und Zertifikat darauf ausgestellt werden.
- Die Datenbankmigrationen laufen automatisch beim Start von `app`.

### HTTPS für Smartphones

Browser erlauben Kamerazugriff nur in einem sicheren Kontext (HTTPS). Deshalb gilt:

- Caddy stellt mit einer lokalen CA ein Zertifikat für `PUBLIC_HOST` aus.
- Das CA-Zertifikat ist unter `http://<PUBLIC_HOST>/ca.crt` abrufbar und wird beim Koppeln per QR-Code angeboten, mit einer bebilderten Anleitung für Android und iOS unter `http://<PUBLIC_HOST>/zertifikat`. Die Bilder zeigen schematisch die Menüs, in denen man tippen muss. **(Annahme)** Unter iOS muss man das Vertrauen zusätzlich unter *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* aktivieren.
- Alternativ kann man die Browserwarnung einmalig bestätigen.
- Arbeitsstationen nutzen HTTP auf Port 80, damit dort keine Zertifikatswarnung erscheint. **(Annahme)**

### Repository und CI/CD

- Das Repository ist [`oktupol/inventur`](https://github.com/oktupol/inventur) und **privat**. Deshalb muss auf jedem Zielrechner einmalig `docker login ghcr.io` mit einem Personal Access Token (Scope `read:packages`) ausgeführt werden. Die README beschreibt das Schritt für Schritt.
- Struktur (Annahme): `apps/server`, `apps/web`, `packages/shared`, `deploy/` (Compose-File, Caddyfile, `.env.example`), `.github/workflows/`.
- Workflow `ci.yml`: Lint, Typprüfung und Tests bei jedem Push und Pull Request.
- Workflow `release.yml`: Bei Push auf `main` und bei Tags `v*` wird das Image gebaut und nach GHCR gepusht, mit den Tags `latest`, `sha-<kurz>` und der Version. Der Server läuft auf Linux. Zielarchitekturen sind `linux/amd64` und `linux/arm64`, damit auch ARM-Rechner wie ein Raspberry Pi funktionieren. **(Annahme für die Architekturen)**
- Das Compose-File referenziert eine feste Version, `latest` ist optional.

### Tests

- Unit-Tests decken die gesamte Fachlogik ab: Statusübergänge von Inventur und Arbeitsbereich, Mitarbeiterzuordnung, Suchauflösung (grün, gelb, rot), Mengenänderungen, Checkpoint-Zählung, Tastatursteuerung, Kopplung und Export-Inhalte.
- Integrationstests gegen eine echte Postgres-Instanz (Testcontainers) für Suche und Migrationen. **(Annahme)**
- Mindestabdeckung der Fachlogik: 80 %. **(Annahme)**

### Nicht-funktionale Anforderungen (Annahme)

- Mengengerüst: bis zu 20 gleichzeitige Arbeitsstationen, bis zu 100.000 Stammdatensätze.
- Suchvorschläge erscheinen in weniger als 200 ms. Ein Scan ist in weniger als 300 ms bestätigt, auch bei schnellen Scan-Folgen, und es darf kein Scan verloren gehen.
- Oberfläche nur auf Deutsch.
- Unterstützte Browser: aktuelle Versionen von Chrome, Edge und Firefox (Desktop) sowie Safari (iOS) und Chrome (Android).
- Bei Verbindungsverlust erscheint auf der Station ein deutlicher Hinweis, die Eingabe wird gesperrt, und die Verbindung wird automatisch wiederhergestellt. Es gibt keine Offline-Warteschlange.
- Eine Datensicherung ist nicht Teil der Anwendung.
- Frühere Inventuren bleiben gespeichert und können im Dashboard eingesehen und exportiert werden.

## Datenmodell der Anwendung (Schema `inventory`, Annahme)

Die Bezeichner in Datenbank und Code sind englisch. In Klammern steht der Fachbegriff aus dieser Spezifikation.

- **stocktake** (Inventur): id, name (Bezeichnung), status (`active` oder `finished`), started_at, finished_at
- **employee** (Mitarbeiter): id, stocktake_id, name (eindeutig je Inventur), workstation_id (nullable = nicht zugewiesen). Löschen nur ohne Erfassungen, die Datenbank verhindert es per Fremdschlüssel.
- **workstation** (Arbeitsstation): id, name (eindeutig), token, work_area_id (nullable), last_seen_at. Löschen nur ohne Erfassungen, die Datenbank verhindert es per Fremdschlüssel.
- **work_area** (Arbeitsbereich): id, stocktake_id, name, description, status (`open`, `in_progress` oder `closed`), closed_at
- **entry** (Erfassung, Zeile): id, stocktake_id, work_area_id, article_id (nullable, ohne Fremdschlüssel, weil die Stammdaten ersetzt werden dürfen), is_manual (bool), input (gescannter oder getippter Code), Momentaufnahme (description, ean, category, price_net, price_gross; bei manuellen Artikeln sind category und price_net leer), serial_number (nullable), quantity (≥ 1), workstation_id, created_at, updated_at, request_id (technisch: eine von der Station vergebene Kennung je Scan, damit eine nach einem Verbindungsabbruch wiederholte Anfrage keine zweite Zeile erzeugt). Gelöschte Zeilen werden endgültig entfernt, es gibt kein Soft-Delete.
- **entry_employee**: entry_id, employee_id. Die Mitarbeiter, die beim Erfassen an der Station angemeldet waren.
- **checkpoint**: id, work_area_id, boundary_at (Grenze: alle Zeilen, die bis zu diesem Zeitpunkt erfasst wurden, liegen davor; beim Anlegen am Ende der Zeitpunkt des Anlegens, beim nachträglichen Einfügen der Erfassungszeitpunkt der gewählten Zeile), workstation_id, created_at. Die Nummer wird aus der Reihenfolge der Grenzen berechnet.
- **pairing** (Kopplung): id, workstation_id, one_time_code, qr_token, valid_until, device_token, paired_at

## Administrations-Dashboard

Das Administrations-Dashboard ist nur vom Computer aus aufrufbar, auf dem das Compose-Projekt läuft (`http://localhost:8080`, der Port ist nur an `127.0.0.1` gebunden).

Der Administrator kann

- Eine Inventur starten (mit Bezeichnung, z. B. „Inventur 2026“). Das geht nur, wenn keine andere Inventur aktiv ist.
- In einer gestarteten Inventur Mitarbeiter hinzufügen und entfernen
  - Ein Mitarbeiter hat nur einen Namen, der innerhalb der Inventur eindeutig ist.
  - Entfernen (Löschen) ist nur möglich, solange der Mitarbeiter keine Artikel erfasst hat. Ein Mitarbeiter mit Erfassungen bleibt also erhalten und lässt sich nur von seiner Station abmelden.
  - Beim Entfernen wird der Mitarbeiter automatisch von seiner Arbeitsstation abgemeldet.
  - Mitarbeiter lassen sich aus der letzten Inventur übernehmen. **(Annahme)**
  - Der Administrator kann einen Mitarbeiter zwangsweise von einer Station abmelden, z. B. wenn ein Rechner ausgeschaltet wurde.
- Arbeitsbereiche definieren
  - Name (eindeutig innerhalb der Inventur) und optionale Beschreibung
  - Anlegen, umbenennen, löschen (nur ohne Erfassungen), abschließen und wieder öffnen
  - Arbeitsbereiche lassen sich aus der letzten Inventur übernehmen. **(Annahme)**
- Namen von Mitarbeitern, Arbeitsbereichen und Arbeitsstationen sind ohne Beachtung der Groß- und Kleinschreibung eindeutig („Anna“ und „anna“ gelten als gleich). Bei der Übernahme aus der letzten Inventur werden bereits vorhandene Namen übersprungen. **(Annahme)**
- Arbeitsstationen verwalten: umbenennen und löschen. Stationen bleiben über Inventuren hinweg bestehen. Löschen ist nur möglich, solange die Station in keiner Inventur Artikel erfasst hat. Angemeldete Mitarbeiter werden beim Löschen abgemeldet.
- Die Inventur beenden
  - Sind noch Arbeitsbereiche nicht abgeschlossen, erscheint eine Warnung mit Liste. Der Administrator kann trotzdem beenden.
  - Nach dem Beenden ist die Inventur schreibgeschützt. Alle Stationen zeigen „Keine aktive Inventur“, und alle Kopplungen werden getrennt.
- Statistiken über die Inventur einsehen (live aktualisiert):
  - Fortschritt: Arbeitsbereiche nach Status
  - Anzahl Zeilen, Stückzahl und Gesamtwert (netto und brutto), gesamt, je Arbeitsbereich und je Kategorie. Manuelle Artikel haben keinen Nettopreis und keine Kategorie. Sie fließen nur in die Bruttosumme ein und werden bei den Kategorien als „ohne Kategorie (manuell)“ ausgewiesen.
  - Erfassungen je Mitarbeiter und je Station sowie die Erfassungsrate über die Zeit
  - Manuell erfasste Artikel (Anzahl, Wert, Liste)
  - Auffälligkeiten: Einzelstücke, die mehrfach erfasst wurden (mehrere Zeilen oder Menge > 1)
  - **Soll/Ist-Abgleich**: Da die Stammdaten Einzelstücke sind, gilt jeder Stammdatenartikel als Soll-Bestand von 1.
    - Fehlbestand: Stammdatenartikel, die in keiner Zeile erfasst wurden (Anzahl, Wert netto und brutto, Liste nach Kategorie)
    - Mehrbestand: Stammdatenartikel mit einer erfassten Gesamtmenge größer als 1, außerdem alle manuell erfassten Artikel
    - Der Abgleich wird immer gegen den aktuellen Stand der Stammdaten berechnet. **(Annahme)**
- Ergebnisse exportieren (während und nach der Inventur):
  - **CSV** (UTF-8 mit BOM, Semikolon-getrennt, deutsches Zahlenformat, damit Excel sie direkt öffnet) und **XLSX**
    - Spalten: Arbeitsbereich, Bezeichnung, EAN, Artikelnummer(n), Kategorie, Seriennummer, Menge, Preis netto, Preis brutto, Summe netto, Summe brutto, manuell (ja/nein), Station, Mitarbeiter, Zeitpunkt
    - Eine Variante als Einzelzeilen und eine aggregiert je Artikel
    - Bei manuellen Artikeln bleiben Nettopreis und Kategorie leer.
    - Der Soll/Ist-Abgleich lässt sich als eigene Liste exportieren (Fehlbestand und Mehrbestand).
  - **PDF-Zählliste** je Arbeitsbereich und gesamt: Kopf mit Inventur, Bereich, Datum und beteiligten Mitarbeitern; Positionen mit Summen; Checkpoints als Zwischensummen **(Annahme)**; Unterschriftsfelder für Zähler und Verantwortlichen

## Arbeitsstationen

Jeder Computer im lokalen Netzwerk soll die Inventur-Seite aufrufen können (`http://<PUBLIC_HOST>/`). Beim erstmaligen Aufrufen muss man den Computer als Arbeitsstation registrieren. Dazu benötigt sie nur einen Namen.

- Die Registrierung wird im Browser gespeichert (Token in `localStorage`). Gehen die Browserdaten verloren, kann man eine bestehende Station per Namensauswahl übernehmen. **(Annahme)**
- Der Stationsname ist eindeutig.
- Der Klick bei der Registrierung beziehungsweise Anmeldung schaltet auch die Tonausgabe frei. Browser blockieren Töne ohne vorherige Nutzerinteraktion.

In einer Arbeitsstation kann man jederzeit aussuchen, welche Mitarbeiter aktuell an einer Arbeitsstation arbeiten. Dabei sind nur die Mitarbeiter auswählbar, die nicht schon wo anders zugewiesen sind. Mitarbeiter dürfen jederzeit zwischen Arbeitsstationen wechseln, müssen sich aber zuerst von der alten Arbeitsstation abmelden.

- Zum Erfassen muss mindestens ein Mitarbeiter an der Station angemeldet sein. **(Annahme)**
- Jede Erfassung speichert die zu diesem Zeitpunkt angemeldeten Mitarbeiter.
- Gibt es keine aktive Inventur, zeigt die Station einen entsprechenden Hinweis.

## Arbeitsbereiche

Ein oder mehrere Arbeitsstationen können einen Arbeitsbereich beitreten. Arbeitsbereiche starten im Status "offen". Wenn mindestens eine Arbeitsstation an einem Arbeitsbereich arbeitet, erhält der Bereich automatisch den Status "in Arbeit". Wenn alles innerhalb eines Arbeitsbereichs erfasst ist, kann man als Nutzer den Arbeitsbereich abschließen. Ein Arbeitsbereich kann auch jederzeit wieder geöffnet werden.

Ergänzende Regeln:

- Eine Station ist höchstens in einem Arbeitsbereich gleichzeitig. Sie kann ihn jederzeit verlassen und einem anderen beitreten.
- Verlässt die letzte Station einen Bereich, der nicht abgeschlossen ist, fällt er auf „offen“ zurück.
- Abschließen kann jede Station, die im Bereich ist, oder der Administrator. Das geht nach einer Sicherheitsabfrage, die die Stückzahl im Bereich anzeigt. Beim Abschließen verlassen alle Stationen den Bereich automatisch.
- In einem abgeschlossenen Bereich kann man nicht erfassen und ihm nicht beitreten.
- Wieder öffnen können Stationen und der Administrator. Der Bereich ist danach „offen“ und wird „in Arbeit“, sobald eine Station beitritt.

```
offen ──(Station tritt bei)──▶ in Arbeit ──(letzte Station verlässt)──▶ offen
  │                              │
  └──────(abschließen)───────────┴──▶ abgeschlossen ──(wieder öffnen)──▶ offen
```

## Erfassung

Während der Erfassung sehen die Nutzer ein Eingabefeld und eine Liste der im aktuellen Arbeitsbereich erfassten Artikel. Die Liste aktualisiert sich automatisch, wenn eine andere Arbeitsstation im selben Bereich Artikel erfasst. Eingabefeld und Liste bilden den Hauptteil der Seite; Arbeitsbereich, Mitarbeiter und gekoppelte Handys stehen kompakt in einer Seitenleiste. Beim Scrollen der Liste bleibt das Eingabefeld sichtbar.

- Die Liste ist nach Erfassungszeit sortiert, die neueste Zeile steht oben.
- Spalten: Zeit, Bezeichnung, EAN oder Artikelnummer, Seriennummer, Menge, Preis brutto, Station und eine Markierung für manuell erfasste Artikel.
- Die **Gesamtanzahl der Artikel** im aktuellen Arbeitsbereich ist jederzeit gut sichtbar neben dem Eingabefeld zu sehen. Gezählt wird die Stückzahl, also die Summe der Mengen. Die Anzeige aktualisiert sich live, auch bei Erfassungen anderer Stationen. Daneben stehen kleiner die Zeilenzahl und der Bruttowert.
- Jede Zeile hat Bedienelemente für die Maus: `+`, `−`, ein direkt editierbares Mengenfeld und `Löschen`. Sie funktionieren unabhängig von den Tastenkürzeln.
- Jeder Scan erzeugt eine **neue Zeile**, auch wenn derselbe Artikel schon erfasst ist. Eine erneute Erfassung eines Einzelstücks wird dabei dezent als Hinweis angezeigt, damit Doppelscans auffallen. **(Annahme)**

Standardmäßig ist das Eingabefeld fokussiert. Beim Eintippen erhält der Nutzer Suchvorschläge, die zu seiner Suche passen. Gesucht werden kann:

    - EAN
    - Bezeichnung
    - Artikelnummer

Suchregeln (Annahme):

- Groß- und Kleinschreibung spielt keine Rolle. Vorschläge erscheinen ab 2 Zeichen, höchstens 20 Stück.
- EAN und Artikelnummer werden per Präfix gesucht. Bei der Bezeichnung wird jedes Wort als Teilstring gesucht, und alle Wörter müssen vorkommen.
- **Exakte Treffer haben Vorrang**: Entspricht die Eingabe genau einer EAN oder Artikelnummer, gilt nur dieser Treffer als Ergebnis, auch wenn es weitere Präfix-Treffer gibt. Das ist für Barcode-Scanner entscheidend.

Sollte es nur noch ein Ergebnis geben, wird eine Autovervollständigung angeboten. Die Ergänzung erscheint als grauer Text im Feld und lässt sich mit `Tab` übernehmen.

Wenn man Enter drückt, wird der Artikel im Arbeitsbereich erfasst und das Suchfeld wird wieder fokussiert. Der Hintergrund wird grün hinterlegt.

Wenn es bei der Bestätigung kein eindeutiges Ergebnis gibt, wird der Hintergrund gelb hinterlegt, und der Benutzer muss den richtigen Artikel auswählen.

- Die Auswahl erfolgt mit den Pfeiltasten und `Enter` oder per Maus. `Esc` bricht ab und leert das Feld.

Wenn es bei der Bestätigung gar kein Ergebnis gibt, wird der Hintergrund rot hinterlegt und ein Ton abgespielt.

- Die Farbmarkierung bleibt bis zur nächsten Eingabe stehen. **(Annahme)**
- Im Fall „rot“ wird angeboten, den Artikel **manuell zu erfassen** (Button und Tastenkürzel `F2`, Annahme). Dafür gibt es ein Formular:
  - Bezeichnung (Pflicht)
  - Bruttopreis (Pflicht, > 0)
  - Seriennummer (optional)
  - Es gibt keinen Nettopreis und keine Kategorie. Beides bleibt leer, eine Kategorie ist nicht wählbar.
  - Die ursprüngliche Eingabe (gescannter Code) wird mitgespeichert.
  - Die Zeile wird als „manuell erfasst“ markiert und in Liste, Statistik und Export entsprechend ausgewiesen.
- Die manuelle Erfassung ist auch ohne vorherigen Fehlscan über dasselbe Kürzel möglich. **(Annahme)**

Es gibt Tastenkombinationen, um erfasste Artikel zu löschen und die Anzahl zu verändern:

    - `Delete` löscht einen Artikel
    - `+` inkrementiert die Anzahl
    - `-` dekrementiert die Anzahl, sofern sie größer als 1 ist.
    - `=` Erlaubt, die Anzahl mit den Zifferntasten einzugeben. Bsp. `= 20 <enter>` setzt sie auf 20
    - Gleiches gilt für `*`, also `* 20 <enter>` setzt sie auf 20.

Regeln für die Tastenkürzel:

- Die Kürzel greifen **nur, wenn das Eingabefeld leer ist**. Sonst werden die Zeichen normal eingegeben, z. B. „AB-123“.
- Sie wirken auf die **ausgewählte Zeile**. Standardmäßig ist das die zuletzt von dieser Station erfasste Zeile. Mit `↑` und `↓` lässt sich eine andere Zeile im Bereich auswählen, `Esc` setzt die Auswahl zurück.
- Die Tasten des Nummernblocks funktionieren gleichwertig.
- `=` oder `*` wechselt in den Mengenmodus. Das Feld zeigt dann „Menge:“, nimmt nur Ziffern an, `Enter` übernimmt, `Esc` bricht ab. Die Menge muss mindestens 1 sein.
- `Delete` löscht ohne Rückfrage, zeigt aber einen Hinweis „Zeile gelöscht“. Die Zeile wird endgültig gelöscht.
- Änderungen erscheinen live auf allen Stationen im Bereich.
- Es gibt kein Rückgängig.

### Checkpoints

- Innerhalb eines Arbeitsbereichs kann jede Station einen Checkpoint erstellen, per Button oder mit dem Tastenkürzel `F3` bei leerem Eingabefeld. **(Annahme für das Kürzel)** Dafür muss mindestens ein Mitarbeiter an der Station angemeldet sein.
- Button und `F3` setzen den Checkpoint immer nach der neuesten Zeile, also am Anfang der Liste. Checkpoints zwischen beliebigen Zeilen lassen sich nachträglich über einen Button anlegen, der erscheint, wenn man mit der Maus über eine Zeile fährt. Der Checkpoint entsteht dann direkt nach dieser Zeile.
- Zwischen zwei Checkpoints und vor dem ersten Checkpoint muss mindestens eine Zeile liegen. Ein Checkpoint, der einen leeren Abschnitt erzeugen würde, wird abgelehnt.
- Checkpoints lassen sich löschen; die beiden Abschnitte werden dann zusammengefasst. Wird die letzte Zeile eines Abschnitts gelöscht, entfällt der Checkpoint, der diesen Abschnitt abschließt, automatisch, und die Station zeigt einen Hinweis.
- Ein Checkpoint wird in der Erfassungsliste als deutlich abgesetzte Trennzeile an seiner Stelle angezeigt. Die Zeile zeigt:
  - die Nummer, den Zeitpunkt und die Station
  - die Anzahl der Artikel **seit dem letzten Checkpoint**, beim ersten Checkpoint seit Beginn des Bereichs
  - die Anzahl der Artikel **seit Beginn des Bereichs**
- Die Nummern ergeben sich aus der Reihenfolge in der Liste (1, 2, 3 … ohne Lücken). Wird ein Checkpoint gelöscht oder nachträglich eingefügt, ändern sich die Nummern der späteren.
- Oberhalb des neuesten Checkpoints wird zusätzlich live angezeigt, wie viele Artikel seit dem letzten Checkpoint erfasst wurden.
- „Anzahl Artikel“ meint wie bei der Gesamtanzahl die Stückzahl, also die Summe der Mengen. **(Annahme)**
- Eine Zeile gehört zu dem Abschnitt, in dem sie erfasst wurde (nach Erfassungszeitpunkt). Wird eine Zeile später geändert oder gelöscht, werden die Zahlen des betroffenen Checkpoints neu berechnet. **(Annahme)**
- Checkpoints sind für alle Stationen im Bereich live sichtbar. Sie bleiben beim Abschließen und Wiedereröffnen erhalten. **(Annahme)**

## Barcode-Scanner

Die ganze Anwendung ist für den Gebrauch mit Barcode-Scannern konzipiert. Klassische Scanner funktionieren wie Tastaturen. Sie geben die Nummer ein und bestätigen mit `<Enter>`. Das sollte mit der oben genannten Funktionalität also passen.

- Die Scanner müssen auf deutsches Tastaturlayout und das Suffix `Enter` konfiguriert sein. Das steht als Hinweis in der README.
- Schnell aufeinanderfolgende Scans werden in der richtigen Reihenfolge verarbeitet und gehen nicht verloren.

Man soll alternativ auch Smartphones als Barcode-Scanner koppeln. Der Kopplungsprozess soll für Laien möglich sein (bsp. per QR Code oder One-Time-Code). Die Kamera des Smartphones wird dann als Scanner verwendet. Erkannte Barcodes werden auf der Arbeitsstation automatisch eingegeben. Auf dem Smartphone sollten dabei Informationen über den gescannten Artikel erscheinen, sowie ein `+`, `-` und `Löschen` Button zum Anpassen der Menge und zum löschen eingeblendet werden.

### Kopplungsablauf

1. Auf der Station klickt man auf „Handy koppeln“. Es erscheinen ein QR-Code mit der HTTPS-URL und einem Einmal-Token sowie alternativ ein sechsstelliger Code mit der URL `https://<PUBLIC_HOST>/scan`.
2. Beides ist 5 Minuten gültig und nur einmal verwendbar. **(Annahme)**
3. Vertraut das Handy dem Zertifikat noch nicht, zeigt die Station zusätzlich einen QR-Code zur CA-Installation mit Kurzanleitung.
4. Nach dem Öffnen ist das Handy gekoppelt. Die Station zeigt „Handy verbunden“ an, und die Kamera startet nach der Berechtigungsabfrage.
5. Die Kopplung bleibt bestehen, bis sie an der Station oder am Handy getrennt wird oder die Inventur endet. Ein Neuladen der Seite hält die Kopplung aufrecht (Geräte-Token).
6. Mehrere Handys pro Station sind erlaubt. **(Annahme)**

### Verhalten beim Scannen

- Unterstützte Formate: EAN-13, EAN-8, UPC-A/E, Code 128, Code 39 und QR. **(Annahme)**
- Derselbe Code wird innerhalb von 2 Sekunden nicht doppelt gelesen. Man bekommt Vibration und Ton als Rückmeldung. **(Annahme)**
- Wahlweise scannt das Handy nur, solange man einen Button gedrückt hält. Die Einstellung wird je Handy gespeichert. Jeder neue Druck darf denselben Code sofort wieder lesen.
- Die Handy-Ansicht füllt den Bildschirm, ohne dass man scrollen muss: Das Kamerabild nimmt den Platz ein, Ergebnis und Auswahl liegen darüber, die Bedienelemente in einer Leiste am unteren Rand.
- Der erkannte Code läuft auf der Station durch dieselbe Logik wie eine Tastatureingabe (grün, gelb, rot).
- Anzeige auf dem Handy:
  - **Grün**: Bezeichnung, EAN, Preis und Menge sowie die Buttons `+`, `−` und `Löschen`. Sie wirken auf die durch diesen Scan erzeugte Zeile.
  - **Gelb**: Auswahlliste auf dem Handy, alternativ die Auswahl an der Station.
  - **Rot**: Hinweis „Artikel unbekannt – bitte an der Station manuell erfassen“.

