/**
 * Krotkotrwaly podpisany token wstepu do rozmowy - zamiast reCAPTCHY.
 *
 * PO CO
 * Allowlista domen opiera sie na naglowku `Origin`, a ten jest trywialny do podrobienia
 * poza przegladarka: `curl -H "Origin: https://emmastudio.pl"` przechodzi bez problemu.
 * Allowlista powstrzymuje wiec obca STRONE przed osadzeniem widgetu, ale nie powstrzyma
 * skryptu w petli, ktory pali limit Gemini.
 *
 * Token wymusza dodatkowy krok: zanim ktos zada pytanie, musi najpierw poprosic nasz
 * wlasny backend o podpis, a potem uzyc go w ciagu kilkunastu minut i z tej samej domeny.
 * Prosty skrypt tego nie robi. Ktos, kto uruchomi prawdziwa przegladarke, obejdzie to -
 * ale taki atak jest o rzedy wielkosci drozszy niz `curl` w petli.
 *
 * DLACZEGO NIE reCAPTCHA
 * Wysylalaby dane kazdego odwiedzajacego do Google przy kazdym wejsciu na strone, a ta
 * strona celowo hostuje u siebie nawet fonty, zeby tego uniknac. Tutaj nie wychodzi
 * nic poza nasz wlasny serwer.
 *
 * CZEGO TOKEN NIE ROBI
 * Nie uwierzytelnia uzytkownika i nie jest tajemnica - kazdy moze go sobie wystawic,
 * wchodzac na strone. Ma tylko podniesc koszt automatycznego naduzycia. Prawdziwym
 * zabezpieczeniem portfela jest dzienny budzet zapytan (src/server/handlers/chat.js).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import config from '../config.js';

const base64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const podpisz = (dane, sekret) => base64url(createHmac('sha256', sekret).update(dane).digest());

/** Czy ochrona tokenem jest wlaczona - decyduje sama obecnosc sekretu. */
export const tokenWymagany = (sekret = config.security.tokenSecret) => Boolean(sekret);

/**
 * Wystawia token zwiazany z domena i chwila wystawienia.
 * @returns {{token: string, expiresAt: number}}
 */
export function wystawToken({
  origin = '',
  now = Date.now(),
  sekret = config.security.tokenSecret,
  ttlMs = config.security.tokenTtlMs,
} = {}) {
  if (!sekret) throw new Error('Brak TOKEN_SECRET po stronie serwera');
  const tresc = `${now}.${origin}`;
  return {
    token: `${base64url(tresc)}.${podpisz(tresc, sekret)}`,
    expiresAt: now + ttlMs,
  };
}

/**
 * Sprawdza token: podpis, waznosc i zgodnosc domeny.
 * @returns {{ok: boolean, powod?: string}}
 */
export function sprawdzToken(token, {
  origin = '',
  now = Date.now(),
  sekret = config.security.tokenSecret,
  ttlMs = config.security.tokenTtlMs,
} = {}) {
  if (!sekret) return { ok: true };                       // ochrona wylaczona
  if (typeof token !== 'string' || !token) return { ok: false, powod: 'brak tokenu' };

  const czesci = token.split('.');
  if (czesci.length !== 2) return { ok: false, powod: 'zly format tokenu' };

  let tresc;
  try {
    tresc = Buffer.from(czesci[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return { ok: false, powod: 'zly format tokenu' };
  }

  // Porownanie odporne na atak czasowy - inaczej mozna by odgadywac podpis znak po znaku.
  const oczekiwany = Buffer.from(podpisz(tresc, sekret));
  const otrzymany = Buffer.from(czesci[1]);
  if (oczekiwany.length !== otrzymany.length || !timingSafeEqual(oczekiwany, otrzymany)) {
    return { ok: false, powod: 'nieprawidlowy podpis' };
  }

  // Dzielimy tylko na PIERWSZEJ kropce: adres domeny sam zawiera kropki
  // (https://emmastudio.pl), wiec zwykly split rozbijal go na kawalki.
  const kropka = tresc.indexOf('.');
  const wystawiony = kropka === -1 ? tresc : tresc.slice(0, kropka);
  const domena = kropka === -1 ? '' : tresc.slice(kropka + 1);
  const czas = Number(wystawiony);
  if (!Number.isFinite(czas)) return { ok: false, powod: 'zly znacznik czasu' };
  // Token z przyszlosci znaczy przestawiony zegar albo probe manipulacji.
  if (czas > now + 60_000) return { ok: false, powod: 'token z przyszlosci' };
  if (now - czas > ttlMs) return { ok: false, powod: 'token wygasl' };
  if (domena !== origin) return { ok: false, powod: 'token wystawiony dla innej domeny' };

  return { ok: true };
}
