import { PhoneMock } from '../components/PhoneMock.tsx';

/**
 * Instructions for trusting the internal CA on smartphones, served over HTTP
 * so phones can open it before they trust the certificate.
 */
export function CertificatePage() {
  const host = window.location.hostname;
  const scanUrl = `https://${host}/scan`;

  return (
    <main className="certificate-page">
      <h1>Handy vorbereiten</h1>
      <p>
        Damit ein Handy seine Kamera als Barcode-Scanner nutzen darf, braucht es eine sichere
        Verbindung zum Inventur-Server. Dafür wird einmalig das Zertifikat des Servers auf dem Handy
        installiert. Das dauert etwa zwei Minuten.
      </p>
      <p>
        <a className="download-button" href="/ca.crt" download="inventur-ca.crt">
          Zertifikat herunterladen
        </a>
      </p>

      <section className="card">
        <h2>iPhone und iPad</h2>
        <ol className="steps">
          <li>
            <p>
              Diese Seite in <strong>Safari</strong> öffnen und oben auf „Zertifikat herunterladen“
              tippen. Bei „Diese Website versucht, ein Konfigurationsprofil zu laden“ auf{' '}
              <strong>Erlauben</strong> und danach auf <strong>Schließen</strong> tippen.
            </p>
          </li>
          <li>
            <p>
              <strong>Einstellungen</strong> öffnen und ganz oben auf{' '}
              <strong>Profil geladen</strong> tippen. Dann <strong>Installieren</strong>, den Code
              des iPhones eingeben und noch zweimal <strong>Installieren</strong> bestätigen.
            </p>
            <PhoneMock
              title="Einstellungen"
              items={['Profil geladen', 'Flugmodus', 'WLAN', 'Bluetooth']}
              highlight={0}
              caption="„Profil geladen“ erscheint ganz oben in den Einstellungen."
            />
          </li>
          <li>
            <p>
              <strong>Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen</strong>{' '}
              öffnen und den Schalter bei <strong>Caddy Local Authority</strong> einschalten. Die
              Rückfrage mit <strong>Fortfahren</strong> bestätigen.
            </p>
            <PhoneMock
              title="Info"
              items={['Name', 'Softwareversion', 'Zertifikatsvertrauenseinstellungen']}
              highlight={2}
              caption="Ganz unten auf der Seite „Info“."
            />
            <PhoneMock
              title="Zertifikatsvertrauen"
              items={['Caddy Local Authority']}
              highlight={0}
              toggle
              caption="Den Schalter einschalten (grün)."
            />
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Android</h2>
        <ol className="steps">
          <li>
            <p>
              Diese Seite in <strong>Chrome</strong> öffnen und oben auf „Zertifikat herunterladen“
              tippen. Die Datei <code>inventur-ca.crt</code> wird gespeichert.
            </p>
          </li>
          <li>
            <p>
              <strong>Einstellungen</strong> öffnen und oben in der Suche{' '}
              <strong>Zertifikat</strong> eingeben. Den Eintrag <strong>CA-Zertifikat</strong> (bei
              manchen Geräten „Zertifikat installieren“) öffnen. Die Menüs heißen je nach Hersteller
              etwas anders, meist liegen sie unter{' '}
              <strong>
                Sicherheit → Weitere Sicherheitseinstellungen → Verschlüsselung und Anmeldedaten
              </strong>
              .
            </p>
            <PhoneMock
              title="Verschlüsselung und Anmeldedaten"
              items={[
                'Telefon verschlüsseln',
                'Vertrauenswürdige Anmeldedaten',
                'Zertifikat installieren',
              ]}
              highlight={2}
              caption="„Zertifikat installieren“ und dann „CA-Zertifikat“ wählen."
            />
          </li>
          <li>
            <p>
              Die Warnung mit <strong>Trotzdem installieren</strong> bestätigen, die Displaysperre
              eingeben und im Ordner „Downloads“ die Datei <code>inventur-ca.crt</code> auswählen.
            </p>
            <PhoneMock
              title="Downloads"
              items={['inventur-ca.crt']}
              highlight={0}
              caption="Die heruntergeladene Datei auswählen."
            />
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Prüfen</h2>
        <p>
          Jetzt <a href={scanUrl}>{scanUrl}</a> öffnen. Die Seite muss ohne Sicherheitswarnung
          erscheinen, dann ist das Handy bereit.
        </p>
        <p className="muted">
          Ohne Zertifikat geht es notfalls auch: Die Warnung des Browsers einmalig bestätigen
          („Erweitert“ → „Weiter zu …“). Das muss man dann aber auf jedem Handy und nach jedem
          Löschen der Browserdaten wiederholen.
        </p>
      </section>
    </main>
  );
}
