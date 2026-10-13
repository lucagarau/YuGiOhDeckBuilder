# Piano di aggiornamenti

Ordine ragionato: prima le cose che oggi danno informazioni **sbagliate**,
poi quelle che allargano a chi usa l'app, infine quelle che la rendono uno
strumento invece di un archivio.

Le versioni **1.0 - 1.3 sono completate**: quel che resta e' in fondo
alla sezione "Fatto". Il piano riparte dalla 1.4.

La dimensione (S / M / L) e' lo sforzo relativo, non una stima di ore.

---

## Da fare subito, fuori dal codice

- [ ] **Attivare GitHub Pages.** *Settings - Pages - Source - GitHub
      Actions*. Finche' manca, il sito risponde 404 e il workflow salta la
      pubblicazione. Richiede la repository pubblica (o un piano a
      pagamento). **E' l'unico passo che blocca tutto il resto.**

---

## 1.4 — Allargare

- [ ] **App installabile offline** (M). Service worker e manifest: il sito
      statico diventa un'app sul telefono che funziona senza rete. Si
      incastra bene con l'architettura attuale, che e' gia' tutta file
      statici piu' JSON.
- [ ] **Mazzi da Master Duel Meta** (M). API aperta, e curiosamente
      raggiungibile anche quando la rete blocca gli altri domini Yu-Gi-Oh.
      Porterebbe il meta recente di Master Duel con i piazzamenti, l'unico
      pezzo di competitivo attuale che manca.
- [ ] **Pagina per archetipo** (M). Tutte le sue carte, i suoi mazzi, le
      sue varianti. I dati ci sono gia' tutti.

## Piu' avanti

- [ ] Confronto fra due mazzi (M).
- [ ] Tema chiaro (S).
- [ ] Aggiungi tre copie con un gesto solo, duplica un mazzo salvato (S).
- [ ] Scorciatoie da tastiera nell'editor (S).

## Scartate, con motivo

- **Trascinare le carte fra le zone**: costa molto e il click fa gia'
  tutto, anche su telefono.
- **Prezzi delle carte**: invecchiano male e non cambiano come si gioca.
- **Account utente**: impossibile su un sito statico, e il `.ydk`
  scaricabile risolve gia' il problema di portarsi via i mazzi.

---

## Note per chi mette mano

- Ogni aggiunta alla logica condivisa va in `web/store.js` e vale per
  entrambe le versioni: non esiste una seconda copia da allineare.
- Ogni modifica allo schema delle carte richiede di riscaricare il
  database: conviene raggrupparle, come si e' fatto per banlist e italiano.
- I test (`node tests/store.test.js`) girano anche nella Action prima della
  pubblicazione: una regressione nella logica condivisa non arriva online.

---

## Fatto

**Versioni 1.0 - 1.3** (tutte completate):

- [x] Liste di divieti per TCG, OCG e Goat, con selettore di formato
      nell'editor e verdetto anche sui mazzi dell'archivio.
- [x] Annulla nell'editor, fino a cinquanta passi.
- [x] Nomi ed effetti in italiano, con ricerca bilingue.
- [x] Esporta e importa `ydke://`.
- [x] Link condivisibile che apre il mazzo nell'editor.
- [x] Decklist stampabile.
- [x] Suggerimenti di sinergia, normalizzati per non restituire staple.
- [x] Statistiche del mazzo con probabilita' di apertura.
- [x] Mazzi simili.

**Prima:**

- [x] Deck builder con ricerca carte per nome, tipo, livello e metadati.
- [x] Scheda della carta al click, con immagine grande ed effetto.
- [x] Sito statico su GitHub Pages con aggiornamento automatico (manca
      solo l'attivazione di Pages).
- [x] Mazzi della saga Tag Force (2.698, tutti e sette i giochi).
- [x] Filtro per funzionamento (burn, stun, chaos, monarca, ...).
- [x] Modalita' casuale con criteri multipli.
- [x] Sezione carte con ricerca su nome ed effetto.
- [x] Collegamento carta - mazzi che la usano.
- [x] Importazione e modifica di mazzi `.ydk`.
