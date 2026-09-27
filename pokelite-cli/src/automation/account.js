// Actions de page (Playwright) : port des routines de content.js.
// L'orchestration (état, Discord, avancement) vit dans campaign.js —
// même séparation que content.js (page) / background.js (orchestrateur)
// dans l'extension Chrome.
const ACCOUNT_URL = 'https://www.pokelite.fr/mon-compte/';
const EDIT_ACCOUNT_URL = 'https://www.pokelite.fr/mon-compte/edit-account/';

export async function gotoAccountPage(page) {
  await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded' });
}

export async function gotoEditAccountPage(page) {
  await page.goto(EDIT_ACCOUNT_URL, { waitUntil: 'domcontentloaded' });
}

export async function isLoggedIn(page) {
  return page.evaluate(() => window.__pokelite.isLoggedIn());
}

export async function registerAccount(page, email) {
  const result = await page.evaluate((e) => window.__pokelite.fillEmailAndSubmit(e, true), email);
  if (result.submitted) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  return result;
}

export async function fillProfile(page, firstName, lastName) {
  const result = await page.evaluate(
    ({ f, l }) => window.__pokelite.fillProfile(f, l, true),
    { f: firstName, l: lastName }
  );
  if (result.saved) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  return result;
}

export async function participateOnUrl(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => window.__pokelite.participate());
}
