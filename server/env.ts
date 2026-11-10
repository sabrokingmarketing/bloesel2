/**
 * True on a real deployment. Vercel sets VERCEL=1 on every build and function;
 * set BLOEISEL_DEPLOYED=1 if hosting somewhere else. Deployed instances refuse
 * to start without a real database, session secret and admin PIN.
 */
export function isDeployed() {
  return !!process.env.VERCEL || process.env.BLOEISEL_DEPLOYED === '1';
}
