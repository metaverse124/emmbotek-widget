/**
 * /api/token - wystawia krotkotrwaly podpis wstepu do rozmowy.
 *
 * Endpoint jest publiczny, ale wylacznie dla domen z allowlisty: token bez pasujacej
 * domeny i tak zostanie odrzucony przy /api/chat. Nie jest to uwierzytelnienie -
 * podnosi tylko koszt automatycznego naduzycia. Szczegoly w src/server/token.js.
 */
import { json, checkOrigin, applyCors, zrodloZadania } from '../http.js';
import { wystawToken, tokenWymagany } from '../token.js';

export function createTokenHandler({ issue = wystawToken } = {}) {
  return async function tokenHandler(req, res) {
    const { ok: originOk, origin } = checkOrigin(req);
    applyCors(res, originOk ? origin : null);

    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'POST') {
      return json(res, 405, { error: 'Dozwolone metody: GET, POST.' });
    }
    if (!originOk) return json(res, 403, { error: 'Niedozwolone zrodlo zadania.' });
    if (!tokenWymagany()) return json(res, 200, { token: null, wymagany: false });

    try {
      const { token, expiresAt } = issue({ origin: zrodloZadania(req) });
      // Token jest krotkotrwaly i zwiazany z domena - nie chcemy, zeby posrednik
      // podal go pozniej komus innemu.
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { token, expiresAt, wymagany: true });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  };
}

export default createTokenHandler;
