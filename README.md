# Yu-Gi-Oh Deck Builder

Webapp locale per cercare mazzi Yu-Gi-Oh presi da internet, filtrarli per
formato, archetipo e funzionamento (burn, stun, chaos, monarca, ...),
**vederli carta per carta** e scaricarli in `.ydk`
(YGOPro / EDOPro / YGO Omega).

Include i mazzi competitivi di YGOPRODeck **e** quelli dei personaggi di
tutta la saga PSP *Tag Force* (1-6 e ARC-V Tag Force Special), piu' una
modalita' casuale per farsi estrarre un mazzo a sorte.

Esiste in due versioni che condividono lo stesso codice: **locale**, con
l'eseguibile e il tasto per aggiornare l'archivio, e **sito statico** su
GitHub Pages, che si aggiorna da solo due volte al giorno.

Nessuna dipendenza da installare: l'eseguibile e' autosufficiente, e da
sorgente bastano Python 3.8+ e la sua libreria standard.

## Avvio

Doppio clic su **`YuGiOhDeckBuilder.exe`**, oppure da terminale:

```bash
python app.py
```

Si apre da solo su <http://127.0.0.1:8777>. Al primo avvio l'archivio e'
vuoto: premi **Aggiorna DB** in alto a destra.

L'eseguibile e quello avviato da terminale condividono lo stesso archivio
`data/`. Se la porta 8777 e' occupata, l'eseguibile prova le successive fino
alla 8796. Per ricostruirlo dopo una modifica al codice:

```bash
python build_exe.py
```

Opzioni utili:

```bash
python app.py --port 9000           # porta diversa
python app.py --no-browser          # non apre il browser
python app.py --update --pages 10   # aggiorna da riga di comando, poi esce
python app.py --export              # riscrive solo i JSON dell'interfaccia
python build_site.py                # assembla il sito statico in _site/
```

## Le due versioni

| | Locale (exe o `python app.py`) | Sito statico (GitHub Pages) |
| --- | --- | --- |
| Ricerca, filtri, random, `.ydk` | si' | si' |
| Tasto "Aggiorna DB" | si' | no: automatico due volte al giorno |
| Immagini carte | proxy locale con cache, funziona offline | direttamente dal CDN |

### Come restano allineate

Non ci sono due applicazioni da tenere sincronizzate a mano: **ricerca,
filtri, sorteggio, dettaglio mazzo e generazione del `.ydk` esistono una
volta sola**, in [`web/store.js`](web/store.js), e le usano entrambe.
Aggiungere un filtro o cambiare il formato del `.ydk` si fa li' e vale
subito per tutte e due.

Quello che cambia e' solo cosa c'e' *intorno*:

- **Python** fa cio' che un browser non puo' fare — scaricare da
  YGOPRODeck, che non manda intestazioni CORS, leggere il wiki, dedurre
  archetipi e funzionamento — e congela il risultato in
  `data/export/*.json`.
- **L'interfaccia** legge sempre e solo quei JSON, in locale come sul
  sito.
- Il server locale espone `/api/capabilities`; su GitHub Pages quella
  chiamata fallisce, e l'interfaccia nasconde da sola i comandi di
  aggiornamento e passa alle immagini remote. Nessun flag da impostare a
  mano, nessuna build separata.

## Pubblicare su GitHub Pages

Una volta sola, nelle impostazioni del repository: **Settings → Pages →
Source → GitHub Actions**.

Poi `.github/workflows/pages.yml` fa il resto: gira alle 07:30 e 19:30
(ora italiana), aggiorna l'archivio, esporta i JSON, assembla il sito e lo
pubblica. Si puo' lanciare anche a mano da **Actions → Run workflow**,
scegliendo quante pagine scaricare o chiedendo di ripubblicare senza
riscaricare nulla.

L'archivio vive nella cache della Action fra un giro e l'altro, cosi' si
accumula invece di ripartire da zero; se la cache sparisce, il giro
successivo lo ricostruisce per intero senza che nessuno debba
intervenire. In git non finisce nulla di generato: ne' il database, ne' i
JSON, ne' il sito.

## Come si usa

1. **Aggiorna DB** scarica carte e mazzi da internet e li salva in SQLite.
   L'ingranaggio accanto al tasto apre le opzioni: quante pagine scaricare
   per formato (20 mazzi a pagina), se riscaricare anche il database carte,
   e su quali formati limitarsi.
2. **Cerca e filtra** per nome o autore, formato, archetipo, funzionamento
   e ordinamento. I filtri lavorano sull'archivio locale, quindi sono
   istantanei e funzionano anche offline.
3. **Apri un mazzo** per vederlo per intero prima di scaricarlo: main, extra
   e side deck con immagini, quantita' e conteggio mostri/magie/trappole.
4. **Scarica .ydk** salva il file; **Anteprima .ydk** mostra il contenuto
   esatto del file prima di salvarlo.
5. **Random** apre la modalita' casuale: scegli uno o piu' formati,
   archetipi e funzionamenti, vedi quanti mazzi rientrano nei criteri e
   premi *Estrai un mazzo*. Dalla scheda del mazzo *Estrai un altro*
   ripesca con gli stessi criteri. Le scelte dentro la stessa categoria
   valgono in OR, fra categorie diverse in AND: "Goat **o** Edison,
   **ma** burn".

## Da dove vengono i dati

### YGOPRODeck

Mazzi competitivi e da community, via endpoint pubblici senza chiave:

| Cosa | Endpoint |
| --- | --- |
| Database carte (~14.600 carte) | `db.ygoprodeck.com/api/v7/cardinfo.php` |
| Ricerca mazzi (20 per pagina) | `ygoprodeck.com/api/decks/getDecks.php` |
| Elenco archetipi (~660) | `ygoprodeck.com/api/autocompleteDeckArchetype.php` |
| Side deck | pagina HTML del mazzo (vedi sotto) |
| Immagini carte | `images.ygoprodeck.com`, via proxy locale con cache |

### Tag Force (wiki Fandom)

La saga PSP non e' su YGOPRODeck. I mazzi dei personaggi sono pero'
documentati sul [wiki Fandom](https://yugioh.fandom.com) dentro template
`{{Decklist}}`, che hanno struttura regolare e quindi si possono leggere:
circa **2.700 mazzi** su tutti e sette i giochi, in una ventina di secondi.

Due tipi di pagina:

- le pagine personaggio `<Nome> (Tag Force)`, con una sezione *Decks*
  divisa per gioco: coprono soprattutto Tag Force 3-6 e Special;
- le pagine `<Gioco>: Character Deck Recipes`, che raccolgono in un elenco
  unico i mazzi di Tag Force 1 e 2.

Tre dettagli non ovvi, risolti leggendo i dati veri:

- **Le pagine personaggio parlano anche di altri giochi.** Sotto *Decks*
  compaiono sezioni per Nightmare Troubadour o Spirit Caller: una
  sottosezione che non nomina Tag Force azzera il gioco corrente, cosi'
  quei mazzi non entrano per sbaglio.
- **I side deck sono blocchi `{{Decklist}}` separati.** "Back to Basics 1 -
  Side Deck" e' il side di "Back to Basics 1", non un mazzo da 15 carte:
  viene riagganciato al suo mazzo.
- **Il wiki indica le carte per nome, non per passcode.** Il 97-98% si
  risolve sul database carte locale; il resto sono carte mai uscite
  dall'OCG o esclusive dei videogiochi. I mazzi che ne perderebbero piu'
  della meta' vengono scartati, gli altri restano con l'elenco di cosa
  manca in evidenza sulla scheda.

### Tempi

Un aggiornamento completo con le impostazioni predefinite (5 pagine x 22
formati di YGOPRODeck, piu' tutto Tag Force) richiede circa un minuto e
mezzo e porta a ~4.500 mazzi.

### Formati disponibili

I 22 formati di YGOPRODeck, fra cui Tournament Meta (TCG, OCG, Worlds,
Genesys), Master Duel, Speed Duel, e i formati retro **Goat**, **Edison**,
**Domain**, **Trinity**; piu' i sette giochi **Tag Force**, trattati come
formati a se' stanti.

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

### Funzionamento (burn, stun, chaos, ...)

Neanche questo e' esposto dalla sorgente, e il titolo lo dichiara solo nel 6%
dei mazzi: il segnale principale sono quindi le carte. Ogni strategia ha
carte firma, schemi cercati nel testo delle carte e soglie tarate sui mazzi
che la dichiarano nel titolo. Un vero mazzo burn ha 10-22 carte che
infliggono danno su 40, mentre "Burning Abyss", che burn non e', ne ha una
sola: la soglia di 7 separa i due casi.

Strategie riconosciute: **Burn**, **Stall**, **Stun/Floodgate**, **Chaos**,
**OTK/FTK**, **Monarca**, **Exodia**, **Mill/Deck Out**, piu' tre ricavate
dalla forma del mazzo quando non emergono carte firma (**Control** se ha
almeno 12 trappole, **Combo** se l'Extra Deck e' pieno, **Aggro** altrimenti).

OTK/FTK e' l'unica strategia in cui il titolo pesa quanto la soglia: un FTK
moderno non ha carte firma, e' una linea di combo che vince al primo turno,
quindi la dichiarazione dell'autore e' il dato migliore disponibile.

Misurata sui mazzi che dichiarano la strategia nel titolo, la precisione e'
del **95%** (80 su 84). Ogni mazzo tiene fino a 3 strategie e il filtro le
considera tutte.

## Dettagli tecnici

- **Provenienza.** La colonna `source` distingue `ygoprodeck` da
  `tagforce`; i mazzi Tag Force usano numeri sopra il miliardo, cosi' non
  possono collidere con quelli di YGOPRODeck, e il numero deriva da un
  hash di gioco + personaggio + titolo, quindi riaggiornare non duplica.
- **Side deck.** La ricerca mazzi non lo restituisce: si trova solo nella
  pagina HTML del mazzo. Viene recuperato alla prima apertura del mazzo e
  salvato in archivio, cosi' il `.ydk` e' completo.
- **Artwork alternativi.** Una carta puo' avere piu' passcode (Ash Blossom e'
  sia `14558127` che `14558128`). I mazzi usano anche quelli secondari, che
  la tabella `card_aliases` riconduce alla carta vera; il `.ydk` conserva
  comunque il passcode originale.
- **Immagini.** In locale passano da `/api/img/<passcode>` con cache su
  disco in `data/imgcache/`, quindi dopo la prima visita il mazzo si apre
  anche senza rete; sul sito statico arrivano direttamente dal CDN.
  Diversi provider italiani bloccano quel dominio (vedi *Problemi noti*):
  una sola immagine di prova al caricamento stabilisce se e' raggiungibile
  e, se non lo e', tutte le carte passano da un proxy di immagini. Senza
  quella prova ogni carta aspetterebbe il timeout della connessione.
- **Aggiornamento.** Gira in un thread separato; l'interfaccia interroga
  `/api/update` per barra di avanzamento e log. Gli upsert sono idempotenti,
  quindi riaggiornare non duplica nulla.

### Struttura

```
YuGiOhDeckBuilder.exe   eseguibile (generato da build_exe.py)
app.py                  avvio del server e CLI
launcher.py             punto di ingresso dell'eseguibile
build_exe.py            compilazione con PyInstaller
build_site.py           assembla il sito statico in _site/
ygodeck/                tutto cio' che il browser non puo' fare
  sources.py            chiamate a YGOPRODeck e deduzione archetipi
  tagforce.py           mazzi della saga Tag Force dal wiki Fandom
  strategies.py         riconoscimento del funzionamento del mazzo
  db.py                 schema SQLite, migrazioni, upsert
  updater.py            job di aggiornamento con avanzamento
  export.py             da SQLite ai JSON letti dall'interfaccia
  server.py             file statici, aggiornamento, proxy immagini
  ydk.py                .ydk da riga di comando (l'app usa store.js)
web/                    l'applicazione, condivisa dalle due versioni
  store.js              dati: ricerca, filtri, random, dettaglio, .ydk
  app.js                interfaccia
.github/workflows/      la Action che aggiorna e pubblica il sito
data/                   database, JSON esportati, cache immagini
                        (generati, non versionati)
```

Node.js e' installato sulla macchina ma il progetto non lo usa: gira
interamente sulla libreria standard di Python, quindi non c'e' niente da
installare ne' da compilare per lo sviluppo.

### API del server locale

Sono rimaste solo quelle che servono davvero: tutto il resto e' passato a
`store.js` ed e' comune alle due versioni.

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | `/api/capabilities` | dice all'interfaccia che c'e' un server locale |
| GET | `/api/update` | stato e log dell'aggiornamento in corso |
| POST | `/api/update` | lo avvia (`pages_per_format`, `formats`, `with_cards`, `with_tagforce`) |
| GET | `/api/formats` | formati scaricabili, per il pannello di aggiornamento |
| GET | `/api/img/<passcode>` | immagine carta con cache (`?size=full` per quella grande) |
| GET | `/data/*.json` | l'archivio esportato, gli stessi file del sito statico |

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
