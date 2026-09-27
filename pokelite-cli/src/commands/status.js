import { loadState, getAccountState, proxyForAccount } from '../config.js';
import { loadSessionMeta } from '../automation/session.js';
import { maskProxy } from '../proxy.js';
import { RAFFLE_LINKS } from '../raffleLinks.js';

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR');
}

export async function statusCommand() {
  const state = await loadState();
  if (state.accounts.length === 0) {
    console.log('Aucun compte enregistré.');
    return;
  }

  const rows = [];
  for (const { email } of state.accounts) {
    const acc = getAccountState(state, email);
    const meta = await loadSessionMeta(email);
    const doneCount = Object.keys(acc.done).length;
    const proxy = maskProxy(proxyForAccount(state, email)) || '—';

    let session = 'aucune sauvegarde';
    if (meta) {
      if (!meta.loggedIn) session = 'non connectée';
      else if (meta.expiresAt && meta.expiresAt < Date.now()) session = 'expirée';
      else if (meta.expiresAt) session = `valide jusqu’au ${fmtDate(meta.expiresAt)}`;
      else session = 'valide (durée inconnue)';
    }

    rows.push({
      email,
      proxy,
      profil: acc.profileFilled ? `${acc.profileName?.firstName || ''} ${acc.profileName?.lastName || ''}`.trim() : '—',
      participations: `${doneCount}/${RAFFLE_LINKS.length}`,
      session,
    });
  }

  console.table(rows);
}
