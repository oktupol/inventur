import type { ErrorCode } from '@inventur/shared';

const MESSAGES: Record<ErrorCode | 'network_error', string> = {
  validation_failed: 'Die Eingabe ist ungültig.',
  not_found: 'Der Eintrag wurde nicht gefunden. Möglicherweise wurde er inzwischen gelöscht.',
  stocktake_already_active: 'Es läuft bereits eine Inventur. Sie muss zuerst beendet werden.',
  stocktake_finished: 'Die Inventur ist beendet und kann nicht mehr geändert werden.',
  stocktake_not_finished: 'Die Inventur ist nicht beendet.',
  unclosed_work_areas: 'Es sind noch nicht alle Arbeitsbereiche abgeschlossen.',
  name_taken: 'Dieser Name ist bereits vergeben.',
  employee_has_entries:
    'Der Mitarbeiter hat bereits Artikel erfasst und kann nicht entfernt werden.',
  work_area_has_entries:
    'Im Arbeitsbereich wurden bereits Artikel erfasst. Er kann nicht gelöscht werden.',
  workstation_has_entries:
    'An der Arbeitsstation wurden bereits Artikel erfasst. Sie kann nicht gelöscht werden.',
  no_previous_stocktake: 'Es gibt keine frühere Inventur, aus der übernommen werden kann.',
  workstation_unknown:
    'Diese Arbeitsstation ist nicht mehr registriert. Bitte neu registrieren oder übernehmen.',
  no_active_stocktake: 'Es läuft keine Inventur.',
  employee_busy:
    'Der Mitarbeiter ist an einer anderen Station angemeldet und muss sich dort zuerst abmelden.',
  employee_not_logged_in: 'Der Mitarbeiter ist an dieser Station nicht angemeldet.',
  work_area_closed: 'Der Arbeitsbereich ist abgeschlossen. Er muss erst wieder geöffnet werden.',
  not_in_work_area: 'Diese Station arbeitet nicht in diesem Arbeitsbereich.',
  no_work_area: 'Die Station ist keinem Arbeitsbereich beigetreten.',
  no_employee_logged_in: 'Zum Erfassen muss mindestens ein Mitarbeiter angemeldet sein.',
  checkpoint_empty_section:
    'Zwischen zwei Checkpoints muss mindestens ein Artikel liegen. Hier wäre der Abschnitt leer.',
  restore_unavailable:
    'Die Zeile kann nicht mehr wiederhergestellt werden, z. B. weil inzwischen eine weitere Zeile gelöscht wurde.',
  pairing_invalid: 'Dieser Code ist nicht gültig. Bitte den Code auf der Station prüfen.',
  pairing_expired: 'Dieser Code ist abgelaufen. Bitte an der Station einen neuen Code erzeugen.',
  pairing_used:
    'Dieser Code wurde schon verwendet. Bitte an der Station einen neuen Code erzeugen.',
  device_unknown: 'Dieses Handy ist nicht mehr mit einer Station gekoppelt.',
  internal_error: 'Auf dem Server ist ein Fehler aufgetreten.',
  network_error: 'Der Server ist nicht erreichbar.',
};

export function errorMessage(code: string): string {
  return MESSAGES[code as ErrorCode] ?? MESSAGES.internal_error;
}
