# Note di sviluppo

Documentazione tecnica del progetto. Per l'uso normale dell'applicazione
vedi il [README](README.md).

Il progetto esiste in due versioni che condividono lo stesso codice:
**locale** (eseguibile o `python app.py`, con il tasto per aggiornare
l'archivio) e **sito statico** su GitHub Pages, aggiornato da una GitHub
Action due volte al giorno.

Nessuna dipendenza da installare: bastano Python 3.8+ e la sua libreria
standard.

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

Una volta sola, su **Settings - Pages - Source**, scegliere **GitHub
Actions**. Senza questo passaggio il sito viene costruito ma la
pubblicazione fallisce con un 404.

> **Repository private.** Sul piano GitHub Free, Pages funziona solo per
> le repository pubbliche: finche' la repository resta privata la voce non
> e' disponibile. Il workflow se ne accorge e salta il deploy invece di
> fallire a ogni giro; appena la repository diventa pubblica riparte da
> solo. Con un piano a pagamento (Pro, Team) si puo' pubblicare restando
> privati: basta impostare la variabile `PUBLISH_PAGES=true` in
> *Settings - Secrets and variables - Actions - Variables*. In entrambi i
> casi il **sito** resta visibile a chiunque: privato e' solo il codice.

Poi ci pensa `.github/workflows/pages.yml`: gira alle 07:30 e 19:30 (ora
italiana), aggiorna l'archivio, esporta i JSON, assembla il sito e lo
pubblica. Si puo' lanciare anche a mano da **Actions - Run workflow**,
scegliendo quante pagine scaricare o chiedendo di ripubblicare senza
riscaricare nulla.

L'archivio vive nella cache della Action fra un giro e l'altro, cosi' si
accumula invece di ripartire da zero; se la cache sparisce, il giro
successivo lo ricostruisce per intero senza che nessuno debba
intervenire. In git non finisce nulla di generato: ne' il database, ne' i
JSON, ne' il sito.

## Dettagli tecnici

- **Provenienza.** La colonna `source` distingue `ygoprodeck` da
  `tagforce`; i mazzi Tag Force usano numeri sopra il miliardo, cosi' non
  possono collidere con quelli di YGOPRODeck, e il numero deriva da un
  hash di gioco + personaggio + titolo, quindi riaggiornare non duplica.
- **Side deck.** La ricerca mazzi non lo restituisce: si trova solo nella
  pagina HTML del mazzo. Viene recuperato alla prima apertura del mazzo e
  salvato in archivio, cosi' il `.ydk` e' completo.
- **Scheda carta.** Cliccando una carta del mazzo si apre una seconda
  finestra sopra la prima. I campi arrivano tutti da `cards.json`:
  `linkval`, `link_markers` e `scale` sono stati aggiunti apposta, perche'
  senza di essi i mostri Link risulterebbero privi di livello e difesa e i
  Pendulum senza scala. La riga delle statistiche si adatta al tipo:
  "Rango" per gli Xyz, "LINK-n" piu' le frecce per i Link, nessuna difesa
  per i Link, sottotipo (Normal, Quick-Play, Continuous) per magie e
  trappole.
- **Sezione carte e "mazzi con questa carta".** Servono un indice
  `passcode -> mazzi` e una copia delle carte con il testo in minuscolo
  per la ricerca sull'effetto. Sono entrambi pesanti e inutili finche'
  nessuno apre quella sezione, quindi si costruiscono alla prima
  richiesta, non al caricamento. L'indice passa dai passcode canonici:
  nei mazzi ci sono 67 artwork alternativi usati 921 volte, e senza
  ricondurli alla carta vera i conteggi sarebbero sbagliati.
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

## Crediti

I dati non sono miei: l'app li raccoglie, li organizza e li converte in
`.ydk`, ma ogni mazzo rimanda alla propria fonte.

- **[YGOPRODeck](https://ygoprodeck.com)** — database delle carte, liste
  dei mazzi e immagini.
- **[Yu-Gi-Oh! Wiki](https://yugioh.fandom.com)** su Fandom — i mazzi dei
  personaggi della saga *Tag Force*, disponibili con licenza
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- **[images.weserv.nl](https://images.weserv.nl)** — usato solo come
  ripiego per le immagini quando il CDN delle carte non e' raggiungibile.

Yu-Gi-Oh! e' un marchio di Konami Digital Entertainment. Questo e' un
progetto amatoriale senza scopo di lucro, non affiliato ne' approvato da
Konami, YGOPRODeck o Fandom; le immagini delle carte restano dei
rispettivi proprietari. Se rappresenti uno di questi soggetti e vuoi che
qualcosa venga rimosso, apri una issue.

## Licenza

Codice sotto licenza [MIT](LICENSE). La licenza copre il codice di questo
repository, non i dati di terzi che l'applicazione scarica a runtime, che
restano soggetti alle condizioni delle rispettive fonti.
