# Arbeitsschritte

Umsetzungsplan für [Anforderung.md](Anforderung.md). Die Schritte bauen aufeinander auf und werden der Reihe nach abgearbeitet. Jeder Schritt endet in einem lauffähigen, getesteten Stand. Pro Schritt entsteht ein eigener Branch und ein Pull Request.

„Fertig, wenn“ beschreibt, woran die Abnahme eines Schritts festgemacht wird. Die Unit-Tests für die im Schritt eingeführte Logik gehören immer zum Schritt dazu.

## Phase 1 – Fundament

### 1. Monorepo-Grundgerüst
- pnpm-Workspaces mit `apps/server`, `apps/web` und `packages/shared`
- TypeScript (strict), ESLint, Prettier und Vitest in allen Paketen
- Server: Fastify mit dem Endpunkt `GET /api/health`
- Web: React und Vite mit Router und leeren Routen `/` (Station), `/admin` und `/scan` (Handy)
- `.gitignore`, `.editorconfig`, kurze README mit den Befehlen für die lokale Entwicklung
- **Fertig, wenn:** `pnpm install`, `pnpm lint`, `pnpm typecheck` und `pnpm test` lokal durchlaufen und `pnpm dev` Server und Frontend startet.

### 2. CI-Workflow
- `.github/workflows/ci.yml`: Installation mit Cache, Lint, Typprüfung und Tests bei jedem Push und Pull Request
- **Fertig, wenn:** Der Workflow auf GitHub grün läuft.

### 3. Container-Image und Release-Workflow
- Mehrstufiges `Dockerfile`: baut Server und Frontend, der Server liefert das Frontend statisch aus.
- `.github/workflows/release.yml`: Build für `linux/amd64` und `linux/arm64` mit Buildx, Push nach `ghcr.io/oktupol/inventur-app` mit den Tags `latest`, `sha-<kurz>` und `v*`
- `deploy/docker-compose.yml` mit `db`, `app` und `proxy` (vorerst nur HTTP auf Port 80), `deploy/.env.example`, erstes `deploy/Caddyfile`
- **Fertig, wenn:** Das Image in GHCR liegt und auf einem frischen Linux-Rechner nach `docker login ghcr.io` und `docker compose up` der Health-Endpunkt über Port 80 antwortet.

### 4. Datenbank und Migrationen
- Datenbankzugriff (z. B. Kysely oder Drizzle) und ein Migrationswerkzeug, das beim Start automatisch migriert
- Schema `master_data` (`article`, `article_number`) mit `pg_trgm` und den Suchindizes
- Schema `inventory` mit allen Tabellen aus dem Datenmodell (stocktake, employee, workstation, work_area, entry, checkpoint, pairing)
- Testcontainers-Setup für Integrationstests, das auch in der CI läuft
- Dummy-Daten-Generator `seed-master-data` (siehe [Anforderung.md](Anforderung.md#dummy-daten-für-testzwecke)):
  - Parameter `--count`, `--seed` und `--replace`
  - Gültige EAN-13, bewusste Dubletten für den Fall „gelb“
  - Aufrufbar mit `pnpm seed` und im Container
  - Die Integrationstests nutzen ihn mit festem Startwert.
- **Fertig, wenn:** Die Migrationen auf einer leeren Datenbank laufen und ein Integrationstest das Schema prüft. Außerdem:
  - Derselbe Startwert erzeugt identische Daten.
  - Alle erzeugten EANs haben eine korrekte Prüfziffer.
  - Ohne `--replace` bricht der Befehl ab, wenn schon Stammdaten vorhanden sind.
  - Im Compose-Setup befüllt `docker compose run --rm app seed-master-data` die Datenbank.

### 4a. Barcode-Testblatt
- Befehl `barcode-test-sheet` (siehe [Anforderung.md](Anforderung.md#barcode-testblatt)) mit den Parametern `--count`, `--seed` und `--output`, aufrufbar mit `pnpm test-sheet` und im Container
- PDF-Erzeugung (z. B. pdfmake) und Barcodes (z. B. bwip-js); die PDF-Bibliothek wird später für die Zählliste wiederverwendet.
- Abschnitte: eindeutig per EAN, eindeutig per Artikelnummer, mehrdeutig, unbekannt, jeweils mit erwartetem Ergebnis
- **Fertig, wenn:**
  - Unit-Tests die Auswahl je Abschnitt abdecken, auch: Unbekannte Codes kommen garantiert nicht in den Stammdaten vor.
  - Ein ausgedrucktes Blatt sich mit einem Handscanner und einer Handykamera vollständig lesen lässt. Die Kamera-Prüfung erfolgt, sobald Schritt 18 fertig ist.

### 5. Echtzeit-Infrastruktur
- WebSocket-Endpunkt mit Kanälen für Admin, Station und Arbeitsbereich
- Server-interner Event-Bus: Fachereignisse werden an die betroffenen Kanäle verteilt.
- Gemeinsame, typisierte Nachrichtenformate in `packages/shared`
- Client-Hook im Frontend mit automatischem Reconnect und einem Verbindungsstatus
- **Fertig, wenn:** Ein Test zeigt, dass ein Ereignis nur die Clients im passenden Kanal erreicht, und der Client nach einem Serverneustart wieder verbunden ist.

## Phase 2 – Verwaltung

### 6. Inventur-Lebenszyklus (Server)
- Starten, mit höchstens einer aktiven Inventur
- Beenden, mit Warnung und Liste der nicht abgeschlossenen Bereiche (Beenden mit Bestätigung trotzdem möglich)
- Nach dem Beenden ist die Inventur schreibgeschützt: Alle schreibenden Endpunkte lehnen dann ab.
- Liste früherer Inventuren
- **Fertig, wenn:** Die Unit-Tests alle Statusübergänge und die Ablehnung von Schreibzugriffen auf beendete Inventuren abdecken.

### 7. Mitarbeiter und Arbeitsbereiche verwalten (Server)
- Mitarbeiter: anlegen, entfernen (nur ohne Erfassungen, mit automatischer Abmeldung von der Station), zwangsweise abmelden, Übernahme aus der letzten Inventur
- Arbeitsstationen: umbenennen, löschen (nur ohne Erfassungen, angemeldete Mitarbeiter werden abgemeldet)
- Arbeitsbereiche: anlegen, umbenennen, löschen (nur ohne Erfassungen), Übernahme aus der letzten Inventur
- Eindeutige Namen innerhalb einer Inventur
- **Fertig, wenn:** Die Unit-Tests alle Regeln und Fehlerfälle abdecken.

### 8. Admin-Dashboard: Verwaltung (UI)
- Layout und Navigation für das Admin-Dashboard
- Seiten für die Inventur (starten, beenden mit Warndialog, Historie), für Mitarbeiter, Arbeitsbereiche und Arbeitsstationen (umbenennen, löschen)
- Live-Aktualisierung über WebSocket
- Im Compose-Setup ist das Dashboard nur über `127.0.0.1:8080` erreichbar. Die Admin-Routen sind über Port 80 gesperrt.
- **Fertig, wenn:** Man eine Inventur vollständig über die Oberfläche anlegen, mit Mitarbeitern und Bereichen befüllen und beenden kann, und das Dashboard von einem anderen Rechner aus nicht erreichbar ist.

## Phase 3 – Arbeitsstation

### 9. Arbeitsstation registrieren und Mitarbeiter zuordnen
- Server: Registrierung mit eindeutigem Namen und Token, Übernahme einer bestehenden Station, `zuletzt_gesehen`
- UI: Registrierungsdialog, Token in `localStorage`, Hinweis „Keine aktive Inventur“
- Mitarbeiter an- und abmelden, wobei nur freie Mitarbeiter auswählbar sind
- Der erste Klick schaltet die Tonausgabe frei.
- **Fertig, wenn:** Zwei Stationen parallel laufen und ein Mitarbeiter erst nach der Abmeldung an der ersten Station an der zweiten angemeldet werden kann.

### 10. Arbeitsbereiche beitreten und Statusautomatik
- Server: beitreten, verlassen, abschließen (mit Sicherheitsabfrage und Stückzahl), wieder öffnen
- Statusübergänge wie im Zustandsdiagramm; Stationen verlassen den Bereich beim Abschließen automatisch.
- UI: Bereichsauswahl mit Status, Beitreten- und Verlassen-Buttons, Abschließen und Wieder öffnen
- Der Status ist live im Dashboard und auf allen Stationen sichtbar.
- **Fertig, wenn:** Die Unit-Tests das Zustandsdiagramm vollständig abdecken, inklusive „letzte Station verlässt“ und „Beitritt zu abgeschlossenem Bereich“.

## Phase 4 – Erfassung

### 11. Artikelsuche (Server)
- Suche über EAN und Artikelnummer (Präfix) und über die Bezeichnung (alle Wörter als Teilstring), ohne Groß- und Kleinschreibung, höchstens 20 Treffer
- Exakte Treffer bei EAN oder Artikelnummer haben Vorrang.
- Auflösung einer bestätigten Eingabe in die Ergebnisse eindeutig, mehrdeutig oder kein Treffer
- **Fertig, wenn:** Die Integrationstests alle Suchregeln abdecken und eine Suche über 100.000 Artikel in weniger als 200 ms antwortet.

### 12. Erfassungsansicht: Eingabe und Liste
- Server: Erfassung anlegen (mit Momentaufnahme der Stammdaten und den angemeldeten Mitarbeitern), Liste je Bereich, Live-Ereignisse
- UI: Eingabefeld (immer fokussiert), Suchvorschläge, Autovervollständigung mit `Tab`
- `Enter` löst grün, gelb (Auswahl mit Pfeiltasten, `Enter` oder `Esc`) oder rot (mit Ton) aus.
- Liste mit der neuesten Zeile oben und dem Hinweis bei erneut erfassten Einzelstücken
- Gut sichtbare Gesamtanzahl mit Stückzahl, Zeilen und Bruttowert
- Scans werden in einer Warteschlange nacheinander verarbeitet, ohne Verluste.
- Bei Verbindungsverlust wird die Eingabe gesperrt, mit deutlichem Hinweis.
- Erfassen ist nur möglich mit angemeldetem Mitarbeiter und in einem Bereich mit passendem Status.
- **Fertig, wenn:** Die Erfassung mit einem echten Barcode-Scanner funktioniert, 20 schnelle Scans vollständig ankommen und eine zweite Station die Einträge live sieht.

### 13. Zeilen bearbeiten
- Server: Menge ändern (mindestens 1) und Soft-Delete, jeweils mit Live-Ereignissen
- UI pro Zeile: `+`, `−`, editierbares Mengenfeld und `Löschen`
- Tastenkürzel nur bei leerem Eingabefeld: `Delete`, `+`, `-`, `=` bzw. `*` mit Mengenmodus, Nummernblock gleichwertig
- Zeilenauswahl: standardmäßig die letzte eigene Zeile, `↑`/`↓` wählen eine andere, `Esc` setzt zurück.
- Hinweis „Zeile gelöscht“
- **Fertig, wenn:** Die Unit-Tests die Tastatursteuerung abdecken und eine Eingabe wie „AB-123“ nicht als Kürzel behandelt wird.

### 14. Manuelle Erfassung
- Formular (Button und `F2`, auch direkt nach einem roten Fehlscan) mit Bezeichnung, Bruttopreis und optionaler Seriennummer; ohne Kategorie und Nettopreis
- Die ursprüngliche Eingabe wird mitgespeichert, die Zeile wird als „manuell“ markiert.
- **Fertig, wenn:** Ein unbekannter Scan in wenigen Tastendrücken manuell erfasst ist und in der Liste markiert erscheint.

### 15. Checkpoints
- Server: Checkpoint anlegen (fortlaufende Nummer je Bereich); Berechnung „seit letztem Checkpoint“ und „seit Beginn“ als Stückzahl, neu berechnet bei Änderungen
- UI: Button und `F3`, Trennzeile in der Liste und der Live-Zähler seit dem letzten Checkpoint
- **Fertig, wenn:** Die Unit-Tests die Zählung abdecken, auch bei nachträglichem Ändern oder Löschen von Zeilen und nach Abschließen und Wiederöffnen.

## Phase 5 – Smartphone als Scanner

### 16. HTTPS mit lokaler CA
- Caddyfile: interne CA, Zertifikat für `PUBLIC_HOST` auf Port 443, HTTP auf Port 80 für die Stationen
- Das CA-Zertifikat ist unter `http://<PUBLIC_HOST>/ca.crt` abrufbar, dazu eine Anleitungsseite für Android und iOS.
- Die CA liegt persistent im Caddy-Volume.
- **Fertig, wenn:** Ein Android- und ein iOS-Gerät nach Installation der CA die HTTPS-Seite ohne Warnung öffnen.

### 17. Kopplung
- Server: Einmal-Token und sechsstelliger Code (5 Minuten gültig, einmalig verwendbar), Geräte-Token, Trennen, automatisches Trennen bei Inventurende
- Station: Dialog „Handy koppeln“ mit QR-Code, Code und Hinweis zur CA-Installation; Anzeige der gekoppelten Handys
- Handy: Code-Eingabe unter `/scan`; die Kopplung übersteht ein Neuladen der Seite.
- **Fertig, wenn:** Die Unit-Tests Gültigkeit, Einmaligkeit und Ablauf abdecken und ein Laie die Kopplung ohne Hilfe schafft.

### 18. Handy-Scanner
- Kamera mit der `BarcodeDetector`-API, ZXing als Fallback; Formate EAN-13, EAN-8, UPC-A/E, Code 128, Code 39 und QR
- Derselbe Code wird 2 Sekunden lang nicht erneut gelesen; Rückmeldung per Vibration und Ton.
- Die Codes laufen auf der Station durch dieselbe Logik wie eine Tastatureingabe.
- Anzeige auf dem Handy: grün mit Artikeldaten und `+`, `−`, `Löschen`; gelb mit Auswahlliste; rot mit Hinweis
- **Fertig, wenn:** Ein Scan mit dem Handy auf der Station erscheint und `+`, `−` und `Löschen` auf dem Handy die richtige Zeile ändern.

## Phase 6 – Auswertung

### 19. Statistik-Dashboard
- Fortschritt der Bereiche, Zeilen, Stückzahl und Werte gesamt, je Bereich und je Kategorie (manuelle Artikel als „ohne Kategorie (manuell)“)
- Erfassungen je Mitarbeiter und je Station, Erfassungsrate über die Zeit
- Manuell erfasste Artikel
- Soll/Ist-Abgleich: Fehlbestand und Mehrbestand
- Live-Aktualisierung
- **Fertig, wenn:** Die Unit-Tests die Kennzahlen-Berechnung abdecken, auch den Soll/Ist-Abgleich.

### 20. Export CSV und XLSX
- Einzelzeilen und je Artikel aggregiert, gesamt und je Bereich
- Soll/Ist-Liste
- CSV mit UTF-8-BOM, Semikolon als Trenner und deutschem Zahlenformat
- **Fertig, wenn:** Die Dateien in Excel und LibreOffice korrekt geöffnet werden, mit Umlauten und Beträgen.

### 21. PDF-Zählliste
- Je Bereich und gesamt: Kopfdaten, Positionen, Checkpoints als Zwischensummen, Summen und Unterschriftsfelder
- **Fertig, wenn:** Das PDF für einen Bereich mit einigen hundert Zeilen korrekt umbricht und die Summen stimmen.

## Phase 7 – Abschluss

### 22. Dokumentation und Release 1.0
- README: Installation (`docker login`, `.env`, `docker compose up`), Befüllen der Stammdaten mit SQL-Beispiel, Konfiguration der Barcode-Scanner, CA-Installation auf Handys, Ablauf einer Inventur
- Das Compose-File referenziert `v1.0.0`.
- Probedurchlauf: eine komplette Inventur mit mehreren Stationen, einem Handy und einem Scanner nach einer Checkliste
- **Fertig, wenn:** Der Probedurchlauf ohne Fehler abgeschlossen ist und der Tag `v1.0.0` veröffentlicht ist.
