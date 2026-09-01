/**
 * Strumieniowanie odpowiedzi do przegladarki (Server-Sent Events).
 *
 * Po co: model potrafi myslec i pisac lacznie 3-7 sekund, a przez ten czas
 * uzytkownik widzial tylko trzy skaczace kropki. Przy strumieniu pierwsze slowa
 * pojawiaja sie od razu po zakonczeniu myslenia, a reszta dopisuje sie w locie.
 * Calkowity czas sie nie zmienia - zmienia sie odczucie, i to zasadniczo.
 *
 * Dlaczego SSE, a nie WebSocket: ruch idzie w jedna strone, dziala po zwyklym
 * HTTP, przechodzi przez funkcje serverless Vercela i nie wymaga zadnej
 * biblioteki po zadnej ze stron.
 *
 * Zdarzenia w kontrakcie:
 *   emocja  {emotion}            - gdy tylko z odpowiedzi da sie odczytac tag emocji
 *   tekst   {message}            - narastajaca tresc odpowiedzi (za kazdym razem CALA)
 *   koniec  {...pelna odpowiedz} - dokladnie ten sam obiekt, co w trybie bez strumienia
 *
 * `tekst` niesie calosc, a nie roznice - dzieki temu zgubiony kawalek niczego
 * nie psuje, a odbiorca nie musi niczego sklejac.
 */
import config from '../config.js';

/**
 * Czy klient prosi o strumien I czy strumien jest wlaczony.
 *
 * DOMYSLNIE WYLACZONY - i to nie jest ostroznosc, tylko wynik pomiaru.
 *
 * Zmierzone na gemini-3.6-flash (2026-09-01, trzy przebiegi):
 *   pierwszy kawalek tekstu  5347 ms | calosc 5802 ms
 *   pierwszy kawalek tekstu  6426 ms | calosc 7104 ms
 * Czekanie to czas MYSLENIA modelu, nie pisania - tekst wychodzi w kilku
 * duzych kawalkach przez ostatnie pol sekundy. Strumien zyskuje wiec ok. 0,5 s
 * z szesciu, a nie sekundy, na ktore liczylem.
 *
 * Gorzej: przy `responseMimeType: application/json`, ktorego wymaga nasz
 * kontrakt, Gemini nie wypuszcza NICZEGO, dopoki cala struktura nie jest
 * gotowa - zmierzone 68-73 s do pierwszego kawalka. W tej konfiguracji
 * strumien nie tylko nic nie daje, ale konczy sie timeoutem i niepotrzebnym
 * powtorzeniem zapytania modelem zapasowym.
 *
 * Cala obsluga zostaje w kodzie, bo dziala i jest przetestowana - wystarczy
 * ustawic GEMINI_STREAMING=true, gdy model zacznie oddawac tekst wczesniej
 * albo gdy porzucimy strukturalny tryb odpowiedzi na rzecz formatu
 * z separatorem. Do tego czasu wlaczanie jej byloby pogorszeniem.
 */
export function chceStrumienia(req) {
  if (!config.gemini.streaming) return false;
  const accept = String(req?.headers?.accept ?? '');
  return accept.includes('text/event-stream');
}

/**
 * Otwiera strumien. Wywolywac dopiero tuz przed wolaniem modelu - po tym
 * momencie nie da sie juz oddac zwyklego kodu bledu, bo naglowki sa wyslane.
 */
export function rozpocznijSSE(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Bez tego posrednicy (m.in. nginx) buforuja odpowiedz i cale
    // strumieniowanie przestaje mieć sens - tekst przychodzi jednym kawalkiem.
    'x-accel-buffering': 'no',
  });
  // Komentarz SSE wypycha naglowki do przegladarki od razu.
  res.write(': polaczono\n\n');
}

export function wyslijZdarzenie(res, nazwa, dane) {
  try {
    res.write(`event: ${nazwa}\ndata: ${JSON.stringify(dane)}\n\n`);
  } catch {
    /* zerwane polaczenie nie moze wywrocic obslugi zapytania */
  }
}

export function zakonczSSE(res) {
  try {
    res.end();
  } catch {
    /* jw. */
  }
}
