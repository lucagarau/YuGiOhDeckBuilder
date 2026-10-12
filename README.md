# Yu-Gi-Oh Deck Builder

Webapp locale per cercare mazzi Yu-Gi-Oh presi da internet, filtrarli per
formato e archetipo, **vederli carta per carta** e scaricarli in `.ydk`
(YGOPro / EDOPro / YGO Omega).

Nessuna dipendenza da installare: solo Python 3.8+ e la sua libreria standard.

## Avvio

```bash
python app.py
```

Si apre da solo su <http://127.0.0.1:8777>. Al primo avvio l'archivio e'
vuoto: premi **Aggiorna DB** in alto a destra.

Opzioni utili:

```bash
python app.py --port 9000      # porta diversa
python app.py --no-browser     # non apre il browser
python app.py --update --pages 10   # aggiorna da riga di comando, poi esce
```

## Come si usa

1. **Aggiorna DB** scarica carte e mazzi da internet e li salva in SQLite.
   L'ingranaggio accanto al tasto apre le opzioni: quante pagine scaricare
   per formato (20 mazzi a pagina), se riscaricare anche il database carte,
   e su quali formati limitarsi.
2. **Cerca e filtra** per nome o autore, formato, archetipo, ordinamento.
   I filtri lavorano sull'archivio locale, quindi sono istantanei e
   funzionano anche offline.
3. **Apri un mazzo** per vederlo per intero prima di scaricarlo: main, extra
   e side deck con immagini, quantita' e conteggio mostri/magie/trappole.
4. **Scarica .ydk** salva il file; **Anteprima .ydk** mostra il contenuto
   esatto del file prima di salvarlo.

## Da dove vengono i dati

Tutto da [YGOPRODeck](https://ygoprodeck.com), via endpoint pubblici senza
chiave:

| Cosa | Endpoint |
| --- | --- |
| Database carte (~14.600 carte) | `db.ygoprodeck.com/api/v7/cardinfo.php` |
| Ricerca mazzi (20 per pagina) | `ygoprodeck.com/api/decks/getDecks.php` |
| Elenco archetipi (~660) | `ygoprodeck.com/api/autocompleteDeckArchetype.php` |
| Side deck | pagina HTML del mazzo (vedi sotto) |
| Immagini carte | `images.ygoprodeck.com`, via proxy locale con cache |

Un aggiornamento completo con le impostazioni predefinite (5 pagine x 22
formati) richiede circa un minuto e porta a ~1.900 mazzi.

### Formati disponibili

I 22 formati del sito, fra cui Tournament Meta (TCG, OCG, Worlds, Genesys),
Master Duel, Speed Duel, e i formati retro **Goat**, **Edison**, **Domain**,
**Trinity**.

### Archetipi

L'API **non** espone l'archetipo del mazzo, quindi va dedotto. Due segnali
imperfetti si correggono a vicenda:

- **Le carte del mazzo.** Contare gli archetipi delle carte da solo non
  basta: ogni mazzo retro risulterebbe "Greed" per via di Pot of Greed e
  simili staple.
- **Il titolo del mazzo.** Copre solo il 70% circa dei mazzi, ma e' preciso.

Un archetipo citato nel titolo *e* presente fra le carte e' la prova piu'
solida e ha la precedenza; in mancanza serve un archetipo con almeno 5 carte,
altrimenti il mazzo resta senza etichetta. Sui dati reali copre circa l'85%
dei mazzi ("Anime Kaiba" -> Blue-Eyes, "Z - One" -> Timelord, "Nash" ->
Shark). Ogni mazzo tiene fino a 3 archetipi e il filtro li considera tutti.

## Dettagli tecnici

- **Side deck.** La ricerca mazzi non lo restituisce: si trova solo nella
  pagina HTML del mazzo. Viene recuperato alla prima apertura del mazzo e
  salvato in archivio, cosi' il `.ydk` e' completo.
- **Artwork alternativi.** Una carta puo' avere piu' passcode (Ash Blossom e'
  sia `14558127` che `14558128`). I mazzi usano anche quelli secondari, che
  la tabella `card_aliases` riconduce alla carta vera; il `.ydk` conserva
  comunque il passcode originale.
- **Immagini.** Passano da `/api/img/<passcode>` con cache su disco in
  `data/imgcache/`: dopo la prima visita il mazzo si apre anche senza rete.
- **Aggiornamento.** Gira in un thread separato; l'interfaccia interroga
  `/api/update` per barra di avanzamento e log. Gli upsert sono idempotenti,
  quindi riaggiornare non duplica nulla.

### Struttura

```
app.py              avvio del server e CLI
ygodeck/
  db.py             schema SQLite, upsert, ricerca
  sources.py        chiamate a YGOPRODeck e deduzione archetipi
  updater.py        job di aggiornamento con avanzamento
  server.py         routing HTTP, API JSON, proxy immagini
  ydk.py            generazione del file .ydk
web/                interfaccia (HTML/CSS/JS, nessun framework)
data/               ygodeck.db e cache immagini (non versionati)
```

### API

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | `/api/status` | statistiche archivio e stato aggiornamento |
| GET | `/api/decks` | ricerca: `q`, `format`, `archetype`, `card_id`, `sort`, `page`, `per_page` |
| GET | `/api/decks/<n>` | mazzo completo con carte risolte e anteprima `.ydk` |
| GET | `/api/decks/<n>/ydk` | scarica il `.ydk` |
| GET | `/api/formats` | formati disponibili e presenti in archivio |
| GET | `/api/archetypes` | archetipi in archivio e vocabolario completo |
| GET | `/api/img/<passcode>` | immagine carta (`?size=full` per quella grande) |
| POST | `/api/update` | avvia l'aggiornamento (`pages_per_format`, `formats`, `with_cards`) |

## Problemi noti

**"Rete non raggiungibile" durante l'aggiornamento.** Diversi provider
italiani bloccano i domini Yu-Gi-Oh a livello di SNI: il DNS risolve ma la
connessione TLS viene resettata. Si riconosce perche' `ygoprodeck.com` non si
apre nemmeno dal browser. Si risolve attivando una VPN.

**Il `.ydk` ha il side deck vuoto.** Succede solo se la pagina del mazzo non
era raggiungibile al momento dell'apertura. Riapri il mazzo per riprovare.

## Limiti attuali

- Solo consultazione e download: non si possono ancora creare o modificare
  mazzi propri (il `.ydk` prodotto e' quello dell'autore originale).
- Nessun controllo di banlist o di legalita' per formato.
