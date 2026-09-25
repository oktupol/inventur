# Probedurchlauf

Checkliste für einen vollständigen Testlauf einer Inventur vor dem Einsatz, mit echter Hardware. Der Durchlauf gilt als bestanden, wenn alle Punkte ohne Fehler abgehakt sind. Abweichungen werden unten im Protokoll festgehalten.

## Aufbau

| Rolle | Gerät |
|---|---|
| Server | Rechner mit Docker, feste IP im LAN, installiert nach [README](README.md#installation) mit der zu prüfenden Version |
| Station A | Rechner mit Browser und **USB-Barcode-Scanner** |
| Station B | zweiter Rechner (oder zweites Browser-Profil) ohne Scanner |
| Handy | Smartphone im selben WLAN (iOS oder Android; idealerweise beide einmal) |
| Admin | Browser direkt auf dem Server (`http://localhost:8080`) oder per SSH-Tunnel |

Außerdem: gedrucktes Barcode-Testblatt und einige echte Artikel bzw. Etiketten.

## 1. Installation

- [ ] `docker login ghcr.io` mit einem Token (`read:packages`) funktioniert.
- [ ] `.env` aus `.env.example` angelegt; `APP_VERSION` ist die zu prüfende Version.
- [ ] `docker compose up -d` startet alle Dienste, `docker compose ps` zeigt `app` als „healthy“.
- [ ] `curl -s http://localhost:8080/api/health` zeigt die erwartete Version.
- [ ] Stammdaten geladen (echte Daten per SQL/CSV oder `seed-master-data --count 5000`).
- [ ] Barcode-Testblatt erzeugt (`barcode-test-sheet`) und in 100 % gedruckt.
- [ ] `http://<PUBLIC_HOST>/admin` von Station A aus zeigt den Hinweis, dass das Dashboard nur auf dem Server erreichbar ist.

## 2. Inventur vorbereiten (Admin)

- [ ] Neue Inventur starten; ein zweiter Start wird abgelehnt, solange sie aktiv ist.
- [ ] Drei Mitarbeiter anlegen; ein doppelter Name (auch „anna“/„Anna“) wird abgelehnt.
- [ ] Drei Arbeitsbereiche anlegen, einer mit Beschreibung.
- [ ] Bei einer Folgeinventur: **Aus letzter Inventur übernehmen** für Mitarbeiter und Bereiche.

## 3. Stationen

- [ ] Station A und B registrieren (Namen „Kasse“, „Lager“). Die Registrierung bleibt nach Neuladen erhalten.
- [ ] In einem privaten Fenster: **Bestehende Station übernehmen** funktioniert.
- [ ] Mitarbeiter an Station A anmelden; an Station B ist er nicht mehr auswählbar.
- [ ] Ohne angemeldeten Mitarbeiter ist keine Erfassung möglich.
- [ ] Beide Stationen treten demselben Bereich bei; im Admin wird er „in Arbeit“.

## 4. Erfassung mit Scanner (Station A)

- [ ] Testblatt Abschnitt 1 (EAN): grün, die Zeile erscheint oben in der Liste.
- [ ] Abschnitt 2 (Artikelnummer, Code 128): grün. Buchstaben und `-` kommen richtig an (Tastaturlayout).
- [ ] Abschnitt 3 (mehrdeutig): gelb; Auswahl mit Pfeiltasten + Enter und per Maus; `Esc` bricht ab.
- [ ] Abschnitt 4 (unbekannt): rot mit Ton; `F2` öffnet **Manuell erfassen** mit dem gescannten Code; Zeile ist als manuell markiert.
- [ ] Zehn Etiketten sehr schnell hintereinander scannen: alle zehn Zeilen erscheinen in der richtigen Reihenfolge.
- [ ] Einen Artikel mit Soll-Anzahl 1 zweimal scannen: zwei Zeilen und ein Hinweis auf den Doppelscan. Bei einem Artikel mit höherer Soll-Anzahl (z. B. Batterie) erscheint kein Hinweis.
- [ ] Station B zeigt alle Zeilen von Station A ohne Neuladen; die Gesamtanzahl stimmt auf beiden Stationen.

## 5. Tastatur und Maus (Station B)

- [ ] Suche nach Teil einer Bezeichnung zeigt Vorschläge; bei einem Treffer ergänzt `Tab`.
- [ ] `+`, `-`, `* 5 Enter`, `= 3 Enter` und `Entf` wirken auf die zuletzt erfasste Zeile, auch über den Nummernblock.
- [ ] `↑`/`↓` wählt eine andere Zeile, `Esc` setzt die Auswahl zurück.
- [ ] Mausbedienung je Zeile: `+`, `−`, Mengenfeld, Löschen.
- [ ] Änderungen erscheinen sofort auf Station A.

## 6. Checkpoints

- [ ] `F3` setzt einen Checkpoint; die Trennzeile zeigt Nummer, Zeit, Station, Stück seit dem letzten Checkpoint und seit Beginn.
- [ ] Nachträglich einen Checkpoint zwischen zwei Zeilen einfügen; die Nummern späterer Checkpoints ändern sich.
- [ ] Einen leeren Abschnitt erzeugen wird verhindert.
- [ ] Letzte Zeile eines Abschnitts löschen: der Checkpoint entfällt mit Hinweis.

## 7. Handy

- [ ] `http://<PUBLIC_HOST>/zertifikat` öffnen, Zertifikat nach Anleitung installieren (iOS: Vertrauen einschalten).
- [ ] An Station A **Handy koppeln**, QR-Code mit der Kamera-App scannen: Station zeigt „Handy verbunden“.
- [ ] Zweites Mal mit dem sechsstelligen Code über `https://<PUBLIC_HOST>/scan` koppeln.
- [ ] Kamera starten; im Standardmodus liest das Handy nur bei gedrücktem Button.
- [ ] Grün: Artikel, Preis und Menge auf dem Handy; `+`, `−` und Löschen wirken auf die Zeile an der Station.
- [ ] Gelb: Auswahl auf dem Handy; alternativ an der Station.
- [ ] Rot: Hinweis „Artikel unbekannt – bitte an der Station manuell erfassen“.
- [ ] Dauerhaftes Scannen einschalten; die Einstellung bleibt nach Neuladen erhalten; derselbe Code wird innerhalb von 2 Sekunden nicht doppelt gelesen.
- [ ] Die Handy-Ansicht lässt sich ohne Scrollen bedienen.
- [ ] Neuladen auf dem Handy hält die Kopplung; **Trennen** an der Station beendet sie.

## 8. Verbindungsverlust

- [ ] Netzwerkkabel bzw. WLAN von Station B kurz trennen: deutlicher Hinweis, Eingabe gesperrt.
- [ ] Nach dem Wiederverbinden ist die Liste ohne Neuladen aktuell.
- [ ] `docker compose restart app` während der Erfassung: Stationen verbinden sich neu, keine Zeile fehlt.

## 9. Bereiche abschließen

- [ ] Station A schließt den Bereich; die Sicherheitsabfrage zeigt die Stückzahl; beide Stationen verlassen den Bereich.
- [ ] In einem abgeschlossenen Bereich kann man nicht beitreten.
- [ ] Wieder öffnen (Station oder Admin): Bereich ist „offen“, nach Beitritt „in Arbeit“.
- [ ] Zweiten Bereich zählen und abschließen, dritten Bereich offen lassen.

## 10. Auswertung (Admin)

- [ ] **Statistik** aktualisiert sich live während einer Erfassung; Summen je Bereich und Kategorie stimmen mit den Stationen überein.
- [ ] Manuelle Artikel erscheinen als „ohne Kategorie (manuell)“ ohne Nettowert.
- [ ] Soll/Ist-Abgleich: Fehl- und Mehrmengen sind plausibel (doppelt gescanntes Einzelstück und manuelle Artikel im Mehrbestand, teilweise gezählte Kleinteile im Fehlbestand); Artikel ohne Soll-Anzahl sind nicht enthalten.
- [ ] CSV-Export in **Excel** öffnen: Umlaute, Beträge als Zahlen, EANs vollständig (nicht `4E+12`), Zeitpunkte als Datum.
- [ ] Dieselbe CSV und die XLSX in **LibreOffice** öffnen.
- [ ] XLSX in Excel öffnen: Kopfzeile fixiert mit Filter, Beträge in €.
- [ ] Export je Bereich enthält nur dessen Zeilen; Soll/Ist-Export enthält alle fehlenden Artikel.
- [ ] PDF-Zählliste eines Bereichs mit mehreren hundert Zeilen: Kopf wiederholt sich auf jeder Seite, Checkpoints als Zwischensummen, Summen stimmen mit der Station überein, Unterschriftsfelder am Ende.
- [ ] PDF-Zählliste gesamt: Übersicht aller Bereiche, dann jeder Bereich auf einer neuen Seite.

## 11. Inventur beenden

- [ ] **Inventur beenden** warnt mit der Liste des offenen Bereichs; trotzdem beenden.
- [ ] Alle Stationen zeigen „Keine aktive Inventur“, das Handy ist getrennt.
- [ ] Die Inventur ist schreibgeschützt; in der **Historie** sind Statistik und Exporte weiterhin abrufbar.
- [ ] Neue Inventur starten: Mitarbeiter und Bereiche lassen sich übernehmen; das Handy vertraut dem Zertifikat weiterhin.

## Protokoll

| Datum | Version | Durchgeführt von | Ergebnis |
|---|---|---|---|
| | | | |

Abweichungen und Fehler (mit Schritt, Gerät, Browser und Beschreibung):

-
