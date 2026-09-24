# Inventur-Erfassung

Ziel ist, eine Webanwendung zu schaffen, die zur Inventurerfassung in einem Uhren- und Schmuckgeschäft verwendet werden kann.

> Legende: Abschnitte ohne Markierung sind abgestimmte Anforderungen. **(Annahme)** kennzeichnet sinnvolle Standardentscheidungen, die ohne Rückmeldung so umgesetzt werden. Offene Punkte stehen am Ende unter [Offene Fragen](#offene-fragen).

## Begriffe

| Begriff | Bedeutung |
|---|---|
| Inventur | Ein Zählvorgang von Start bis Ende. Es gibt höchstens eine aktive Inventur gleichzeitig. |
| Arbeitsstation | Ein Browser auf einem Rechner im LAN, der unter einem Namen registriert ist. |
| Mitarbeiter | Eine Person, die an einer Inventur mitzählt (nur Name, keine Anmeldung). |
| Arbeitsbereich | Ein physischer Zählbereich, z. B. „Vitrine 3“ oder „Lager Uhren“. |
| Erfassung (Zeile) | Ein erfasster Artikel mit Menge in einem Arbeitsbereich. **Jeder Scan erzeugt eine neue Zeile**, auch beim selben Artikel. |
| Kopplung | Die Verbindung eines Smartphones als Kamera-Scanner mit einer Arbeitsstation. |

## Stammdaten

Die Stammdaten werden vom Administrator in eine Postgres-Datenbank abgelegt. Die Postgres-Datenbank soll für die Stammdaten folgende Informationen beinhalten:

    - Bezeichnung
    - EAN
    - Preis (brutto und netto)
    - Kategorie
    - 0-n Artikelnummern

Die Stammdaten können aus verschiedenen Quellen kommen. Die Anwendung gibt deshalb **feste Zieltabellen** vor, und der Administrator ist dafür verantwortlich, sie im Vorfeld zu befüllen (per SQL, ETL-Tool o. ä.). Die Anwendung liest die Stammdaten nur und ändert sie nie.

Jeder Stammdatensatz ist ein **Einzelstück**, d. h. ein physischer Artikel mit eigener EAN oder Artikelnummer. Die Menge pro Zeile bleibt trotzdem änderbar, z. B. für Kleinteile wie Batterien oder Armbänder.

### Schema `stammdaten` (Annahme)

```sql
CREATE TABLE stammdaten.artikel (
    id            BIGSERIAL PRIMARY KEY,
    bezeichnung   TEXT          NOT NULL,
    ean           TEXT          NULL,       -- optional, nicht eindeutig erzwungen
    preis_netto   NUMERIC(12,2) NOT NULL,
    preis_brutto  NUMERIC(12,2) NOT NULL,
    kategorie     TEXT          NULL        -- flache Kategorie, keine Hierarchie
);

CREATE TABLE stammdaten.artikelnummer (
    artikel_id  BIGINT NOT NULL REFERENCES stammdaten.artikel(id) ON DELETE CASCADE,
    nummer      TEXT   NOT NULL,
    PRIMARY KEY (artikel_id, nummer)
);
```

- Das Schema wird von der Anwendung beim Start per Migration angelegt. Der Administrator befüllt nur die Tabellen.
- Die Suchindizes (z. B. `pg_trgm` auf Bezeichnung, Indizes auf EAN und Artikelnummer) legt ebenfalls die Anwendung an.
- EAN und Artikelnummern sind nicht zwingend eindeutig. Mehrdeutigkeiten werden bei der Erfassung aufgelöst (Fall „gelb“).
- Währung ist EUR. **(Annahme)**
- Die Stammdaten dürfen sich während einer Inventur ändern. Jede Erfassung speichert deshalb eine **Momentaufnahme** von Bezeichnung, EAN, Kategorie und Preisen zum Zeitpunkt der Erfassung, damit das Inventurergebnis stabil bleibt. **(Annahme)**
- Der Postgres-Port wird nur auf `127.0.0.1` des Host-Rechners veröffentlicht, damit der Administrator die Daten mit eigenen Werkzeugen befüllen kann. **(Annahme)**

## Architektur

Die Anwendung soll als docker-compose Projekt laufen. Die Software soll in einem Mono-Repository auf Github liegen. Selbst entwickelte Software-Komponenten werden in der Github Container Registry veröffentlicht, sodass man nur mit dem Docker-Compose-File die Anwendung von jedem Computer aus starten kann. Die Anwendung wird nicht aus dem Internet erreichbar sein. Eine Authentifizierung ist nicht notwendig, auch nicht für den Administrator.

Das Repository muss noch angelegt werden, zusammen mit den Workflow-Files, die die Images erstellen und veröffentlichen.

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
| `app` | `ghcr.io/<owner>/inventur-app` (eigenes Image: API und ausgeliefertes Frontend) | nur intern |
| `proxy` | `caddy:2` | `80` (HTTP, Arbeitsstationen), `443` (HTTPS, Smartphones), `127.0.0.1:8080` (Admin-Dashboard) |

- Volumes für die Postgres-Daten und die Caddy-Daten (die CA muss Neustarts überleben).
- Konfiguration per `.env`: `PUBLIC_HOST` (IP oder Hostname des Servers im LAN, wird für QR-Codes und das Zertifikat benötigt) und `POSTGRES_PASSWORD`.
- Der Server sollte eine feste IP haben (z. B. per DHCP-Reservierung), da QR-Codes und Zertifikat darauf ausgestellt werden.
- Die Datenbankmigrationen laufen automatisch beim Start von `app`.

### HTTPS für Smartphones

Browser erlauben Kamerazugriff nur in einem sicheren Kontext (HTTPS). Deshalb gilt:

- Caddy stellt mit einer lokalen CA ein Zertifikat für `PUBLIC_HOST` aus.
- Das CA-Zertifikat ist unter `http://<PUBLIC_HOST>/ca.crt` abrufbar und wird beim Koppeln per QR-Code angeboten, mit einer bebilderten Anleitung für Android und iOS. Unter iOS muss man das Vertrauen zusätzlich unter *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen* aktivieren.
- Alternativ kann man die Browserwarnung einmalig bestätigen.
- Arbeitsstationen nutzen HTTP auf Port 80, damit dort keine Zertifikatswarnung erscheint. **(Annahme)**

### Repository und CI/CD

- Das Repository ist **privat**. Deshalb muss auf jedem Zielrechner einmalig `docker login ghcr.io` mit einem Personal Access Token (Scope `read:packages`) ausgeführt werden. Die README beschreibt das Schritt für Schritt.
- Struktur (Annahme): `apps/server`, `apps/web`, `packages/shared`, `deploy/` (Compose-File, Caddyfile, `.env.example`), `.github/workflows/`.
- Workflow `ci.yml`: Lint, Typprüfung und Tests bei jedem Push und Pull Request.
- Workflow `release.yml`: Bei Push auf `main` und bei Tags `v*` wird das Image gebaut und nach GHCR gepusht, mit den Tags `latest`, `sha-<kurz>` und der Version. Zielarchitekturen sind `linux/amd64` und `linux/arm64`. **(Annahme)**
- Das Compose-File referenziert eine feste Version, `latest` ist optional.

### Tests

- Unit-Tests decken die gesamte Fachlogik ab: Statusübergänge von Inventur und Arbeitsbereich, Mitarbeiterzuordnung, Suchauflösung (grün, gelb, rot), Mengenänderungen, Tastatursteuerung, Kopplung und Export-Inhalte.
- Integrationstests gegen eine echte Postgres-Instanz (Testcontainers) für Suche und Migrationen. **(Annahme)**
- Mindestabdeckung der Fachlogik: 80 %. **(Annahme)**

### Nicht-funktionale Anforderungen (Annahme)

- Mengengerüst: bis zu 20 gleichzeitige Arbeitsstationen, bis zu 100.000 Stammdatensätze.
- Suchvorschläge erscheinen in weniger als 200 ms. Ein Scan ist in weniger als 300 ms bestätigt, auch bei schnellen Scan-Folgen, und es darf kein Scan verloren gehen.
- Oberfläche nur auf Deutsch.
- Unterstützte Browser: aktuelle Versionen von Chrome, Edge und Firefox (Desktop) sowie Safari (iOS) und Chrome (Android).
- Bei Verbindungsverlust erscheint auf der Station ein deutlicher Hinweis, die Eingabe wird gesperrt, und die Verbindung wird automatisch wiederhergestellt. Es gibt keine Offline-Warteschlange (siehe offene Fragen).
- Frühere Inventuren bleiben gespeichert und können im Dashboard eingesehen und exportiert werden.

## Datenmodell der Anwendung (Schema `inventur`, Annahme)

- **inventur**: id, bezeichnung, status (`aktiv` oder `beendet`), gestartet_am, beendet_am
- **mitarbeiter**: id, inventur_id, name, arbeitsstation_id (nullable = nicht zugewiesen)
- **arbeitsstation**: id, name (eindeutig), token, arbeitsbereich_id (nullable), zuletzt_gesehen
- **arbeitsbereich**: id, inventur_id, name, beschreibung, status (`offen`, `in_arbeit` oder `abgeschlossen`), abgeschlossen_am
- **erfassung**: id, inventur_id, arbeitsbereich_id, artikel_id (nullable), manuell (bool), eingabe (gescannter oder getippter Code), Momentaufnahme (bezeichnung, ean, kategorie, preis_netto, preis_brutto), seriennummer (nullable), menge (≥ 1), arbeitsstation_id, mitarbeiter_ids (die zum Zeitpunkt zugewiesenen Mitarbeiter), erfasst_am, geaendert_am, geloescht_am (Soft-Delete für die Nachvollziehbarkeit)
- **kopplung**: id, arbeitsstation_id, einmalcode, qr_token, gueltig_bis, geraet_token, gekoppelt_am

## Administrations-Dashboard

Das Administrations-Dashboard ist nur vom Computer aus aufrufbar, auf dem das Compose-Projekt läuft (`http://localhost:8080`, der Port ist nur an `127.0.0.1` gebunden).

Der Administrator kann

- Eine Inventur starten (mit Bezeichnung, z. B. „Inventur 2026“). Das geht nur, wenn keine andere Inventur aktiv ist.
- In einer gestarteten Inventur Mitarbeiter hinzufügen und entfernen
  - Ein Mitarbeiter hat nur einen Namen, der innerhalb der Inventur eindeutig ist.
  - Beim Entfernen wird der Mitarbeiter automatisch von seiner Arbeitsstation abgemeldet. Bisherige Erfassungen bleiben ihm zugeordnet.
  - Mitarbeiter lassen sich aus der letzten Inventur übernehmen. **(Annahme)**
  - Der Administrator kann einen Mitarbeiter zwangsweise von einer Station abmelden, z. B. wenn ein Rechner ausgeschaltet wurde.
- Arbeitsbereiche definieren
  - Name (eindeutig innerhalb der Inventur) und optionale Beschreibung
  - Anlegen, umbenennen, löschen (nur ohne Erfassungen), abschließen und wieder öffnen
  - Arbeitsbereiche lassen sich aus der letzten Inventur übernehmen. **(Annahme)**
- Arbeitsstationen verwalten: umbenennen und löschen. Stationen bleiben über Inventuren hinweg bestehen.
- Die Inventur beenden
  - Sind noch Arbeitsbereiche nicht abgeschlossen, erscheint eine Warnung mit Liste. Der Administrator kann trotzdem beenden. **(Annahme)**
  - Nach dem Beenden ist die Inventur schreibgeschützt. Alle Stationen zeigen „Keine aktive Inventur“, und alle Kopplungen werden getrennt.
- Statistiken über die Inventur einsehen (live aktualisiert):
  - Fortschritt: Arbeitsbereiche nach Status
  - Anzahl Zeilen, Stückzahl und Gesamtwert (netto und brutto), gesamt, je Arbeitsbereich und je Kategorie
  - Erfassungen je Mitarbeiter und je Station sowie die Erfassungsrate über die Zeit
  - Manuell erfasste Artikel (Anzahl, Wert, Liste)
  - Auffälligkeiten: Einzelstücke, die mehrfach erfasst wurden (mehrere Zeilen oder Menge > 1)
  - Nicht erfasste Stammdatenartikel, also der Soll/Ist-Abgleich (siehe offene Fragen)
- Ergebnisse exportieren (während und nach der Inventur):
  - **CSV** (UTF-8 mit BOM, Semikolon-getrennt, deutsches Zahlenformat, damit Excel sie direkt öffnet) und **XLSX**
    - Spalten: Arbeitsbereich, Bezeichnung, EAN, Artikelnummer(n), Kategorie, Seriennummer, Menge, Preis netto, Preis brutto, Summe netto, Summe brutto, manuell (ja/nein), Station, Mitarbeiter, Zeitpunkt
    - Eine Variante als Einzelzeilen und eine aggregiert je Artikel
  - **PDF-Zählliste** je Arbeitsbereich und gesamt: Kopf mit Inventur, Bereich, Datum und beteiligten Mitarbeitern; Positionen mit Summen; Unterschriftsfelder für Zähler und Verantwortlichen

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

Während der Erfassung sehen die Nutzer ein Eingabefeld und eine Liste der im aktuellen Arbeitsbereich erfassten Artikel. Die Liste aktualisiert sich automatisch, wenn eine andere Arbeitsstation im selben Bereich Artikel erfasst.

- Die Liste ist nach Erfassungszeit sortiert, die neueste Zeile steht oben.
- Spalten: Zeit, Bezeichnung, EAN oder Artikelnummer, Seriennummer, Menge, Preis brutto, Station und eine Markierung für manuell erfasste Artikel.
- Darüber steht eine Summenzeile für den Bereich mit Zeilen, Stückzahl und Wert.
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
  - Der Nettopreis wird mit einem konfigurierbaren MwSt.-Satz berechnet, standardmäßig 19 %. **(Annahme)**
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
- `Delete` löscht ohne Rückfrage, zeigt aber einen Hinweis „Zeile gelöscht“. Intern wird nur ein Soft-Delete durchgeführt.
- Änderungen erscheinen live auf allen Stationen im Bereich.

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
- Der erkannte Code läuft auf der Station durch dieselbe Logik wie eine Tastatureingabe (grün, gelb, rot).
- Anzeige auf dem Handy:
  - **Grün**: Bezeichnung, EAN, Preis und Menge sowie die Buttons `+`, `−` und `Löschen`. Sie wirken auf die durch diesen Scan erzeugte Zeile.
  - **Gelb**: Auswahlliste auf dem Handy, alternativ die Auswahl an der Station.
  - **Rot**: Hinweis „Artikel unbekannt – bitte an der Station manuell erfassen“.

## Offene Fragen

Diese Punkte blockieren den Start der Implementierung nicht. Die genannte Annahme wird umgesetzt, falls keine Rückmeldung kommt.

1. **GitHub-Owner und Repository-Name**: Unter welchem Account oder welcher Organisation soll das Repository liegen, und wie soll es heißen? Vorschlag: `inventur`.
2. **Soll/Ist-Abgleich**: Da die Stammdaten Einzelstücke sind, lässt sich eine Liste „in Stammdaten, aber nicht erfasst“ (Fehlbestand) erzeugen. Soll das in Statistik und Export? Annahme: ja, als eigene Auswertung.
3. **MwSt. bei manuellen Artikeln**: Ist ein fester Satz von 19 % richtig, oder gibt es Sonderfälle wie differenzbesteuerte Gebrauchtware oder Altgold? Annahme: 19 %, im Dashboard konfigurierbar.
4. **Offline-Verhalten**: Reicht es, die Eingabe bei Verbindungsverlust zu sperren, oder sollen Scans lokal gepuffert und später übertragen werden? Annahme: sperren.
5. **Rückgängig**: Soll es ein Rückgängig für Löschen und Mengenänderung geben (z. B. `Strg+Z`)? Annahme: nein, das Soft-Delete reicht für die Nachvollziehbarkeit.
6. **Zielhardware**: Auf welchem Rechner läuft das Compose-Projekt (Windows mit Docker Desktop, Linux, Raspberry Pi)? Das ist relevant für die Image-Architekturen und die README. Annahme: amd64 und arm64.
7. **Inventur beenden**: Soll das Beenden nur möglich sein, wenn alle Arbeitsbereiche abgeschlossen sind? Annahme: Warnung, aber erlaubt.
8. **Datensicherung**: Wird ein Backup-Mechanismus benötigt (z. B. ein `pg_dump`-Dienst mit täglicher Sicherung in ein Host-Verzeichnis)? Annahme: ein einfaches Backup-Skript und eine Anleitung in der README.
9. **Kategorie bei manuellen Artikeln**: Soll man bei der manuellen Erfassung optional eine Kategorie aus den vorhandenen wählen können, damit die Kategorie-Statistik vollständig ist? Annahme: ja, optional.
