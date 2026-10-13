# Yu-Gi-Oh Deck Builder

Cerca fra **migliaia di mazzi Yu-Gi-Oh**, guardali carta per carta e
scaricali pronti da importare nei simulatori di duello.

**[Apri il sito](https://lucagarau.github.io/YuGiOhDeckBuilder/)** —
non serve installare niente.

---

## Cosa trovi dentro

Oltre 4.500 mazzi, raccolti da due mondi diversi:

- **Mazzi da torneo e da community**, nei formati moderni e in quelli
  retro come Goat, Edison e Domain.
- **I mazzi dei personaggi di _Tag Force_**, tutti e sette i giochi per
  PSP: il mazzo di Jaden in Tag Force 3, quello di Jack Atlas in Tag
  Force 5, e cosi' via.

Puoi cercarli per nome o autore e filtrarli per:

| Filtro | Esempi |
| --- | --- |
| **Formato** | Goat, Edison, Master Duel, Tag Force 1-6, Tag Force Special |
| **Archetipo** | Blue-Eyes, Elemental HERO, Zoodiac, Monarch |
| **Funzionamento** | Burn, Stun, Chaos, Monarca, Exodia, Mill, OTK/FTK, Control, Combo, Aggro |

Il **funzionamento** e' il modo in cui il mazzo vince. Quasi nessun
autore lo dichiara, cosi' lo riconosce l'app guardando le carte.

## Come si usa

1. **Cerca o filtra** i mazzi dalla barra in alto.
2. **Clicca un mazzo** per vederlo intero prima di scaricarlo: main deck,
   extra e side, con le immagini di tutte le carte e il conteggio di
   mostri, magie e trappole.
3. **Clicca una carta** per vederne la scheda: immagine grande, effetto
   completo, attributo, tipo, livello (o rango, o valore Link con le
   frecce), ATK e DEF, archetipo e passcode. Da li' il tasto **Mazzi con
   questa carta** ti mostra tutti i mazzi che la usano.
4. **Scarica .ydk** per salvare il file. _Anteprima .ydk_ ti mostra prima
   cosa contiene.

### La sezione Carte

In alto puoi passare da **Mazzi** a **Carte** e sfogliare tutte le carte
che compaiono nell'archivio. Si cercano per nome **o per effetto** (prova
"banish", "once per turn") e si filtrano per categoria, attributo, tipo,
livello e archetipo.

Di default sono ordinate per quanto vengono usate, cosi' vedi subito
quali sono le piu' giocate; sotto ogni carta c'e' in quanti mazzi
compare, e cliccandola si apre la stessa scheda di dettaglio.

## Creare un mazzo

La scheda **Crea mazzo** e' un editor completo. Puoi partire da zero,
**importare un file `.ydk`** che hai gia', oppure aprire un mazzo
dell'archivio e premere **Modifica mazzo**: ne prende una copia, cosi'
l'originale resta com'e'.

Si usa cosi':

- **Clicca una carta** nel pannello di destra per aggiungerla. Finisce da
  sola nella zona giusta: i mostri Fusione, Synchro, Xyz e Link vanno
  nell'Extra Deck, tutto il resto nel Main.
- Il tasto **S** sull'angolo della carta la manda nel **Side Deck**.
- **Clicca una carta del mazzo** per togliere una copia.

In alto vedi sempre quante carte hai in ogni zona e cosa non va: massimo
tre copie della stessa carta in tutto il mazzo, Main fra 40 e 60, Extra e
Side fino a 15. I conteggi diventano verdi quando il mazzo e' a posto.

Quando hai finito, **Scarica .ydk** oppure **Salva** per tenerlo in
**I miei mazzi**.

> I mazzi salvati restano **nel tuo browser, su questo computer**: non
> vengono caricati da nessuna parte. Se cancelli i dati del sito o apri
> il sito da un altro dispositivo non li trovi. Per non perderli, scarica
> il `.ydk`.

### Il tasto Random

Se non sai cosa giocare, premi **Random**: scegli uno o piu' formati,
archetipi e funzionamenti, e l'app estrae un mazzo a caso fra quelli che
rientrano nei criteri. Ti dice anche quanti ce ne sono prima di pescare,
e da li' puoi continuare a estrarne altri.

Le scelte nella stessa categoria valgono come "oppure", fra categorie
diverse come "e". Per esempio: _Goat **oppure** Edison, **ma** burn_.

## Cosa farci con il file .ydk

Il `.ydk` e' il formato standard dei simulatori di duello. Una volta
scaricato, mettilo nella cartella dei mazzi del tuo programma:

| Programma | Cartella |
| --- | --- |
| **EDOPro** | `deck` |
| **YGO Omega** | `Data/Decks` |
| **YGOPro** | `deck` |

Al riavvio il mazzo compare nell'elenco.

## Usare l'app sul computer

Il sito basta per quasi tutto. L'app da scaricare serve se vuoi
**funzionare anche senza internet**: tiene l'archivio e le immagini sul
tuo computer, quindi dopo il primo uso continua a funzionare offline, e
puoi aggiornare i mazzi quando vuoi invece di aspettare.

1. Scarica **`YuGiOhDeckBuilder.exe`** dalla
   [pagina dei rilasci](https://github.com/lucagarau/YuGiOhDeckBuilder/releases/latest).
2. Mettilo in una cartella sua: ci creera' accanto l'archivio dei mazzi.
3. Doppio clic. Si apre da solo nel browser.
4. Al primo avvio l'archivio e' vuoto: premi **Aggiorna DB** e aspetta un
   paio di minuti.

Solo Windows, e non c'e' niente da installare.

## Domande frequenti

**Windows dice che il file e' pericoloso.**
E' un programma senza firma digitale, e Windows avvisa per tutti quanti.
Scegli _Ulteriori informazioni_ e poi _Esegui comunque_. Se preferisci
non fidarti, usa il sito: fa le stesse cose.

**Non si vedono le immagini delle carte.**
Diversi operatori italiani bloccano i siti Yu-Gi-Oh. L'app se ne accorge
e passa da una strada alternativa, ma se restano riquadri vuoti prova con
una VPN attiva.

**Nell'app, "Aggiorna DB" da' errore di rete.**
Stessa causa: l'operatore blocca i siti da cui arrivano i mazzi. Accendi
una VPN e riprova, oppure usa il sito, che e' gia' aggiornato.

**Un mazzo ha qualche carta in meno dell'originale.**
Succede solo con certi mazzi di Tag Force, che usano carte mai uscite
fuori dal Giappone o inventate per il videogioco: non esistono nei
simulatori, quindi non possono entrare nel file. L'app te lo dice in cima
al mazzo ed elenca quali mancano.

**Ogni quanto arrivano mazzi nuovi?**
Il sito si aggiorna da solo due volte al giorno. Nell'app, quando premi
_Aggiorna DB_.

**I mazzi che salvo si vedono anche dal telefono?**
No: restano nel browser del computer su cui li hai salvati. Per portarli
altrove scarica il `.ydk`.

## Crediti

I dati non sono miei: l'app li raccoglie, li organizza e li converte in
`.ydk`, e ogni mazzo rimanda alla propria fonte.

- **[YGOPRODeck](https://ygoprodeck.com)** — database delle carte, liste
  dei mazzi e immagini.
- **[Yu-Gi-Oh! Wiki](https://yugioh.fandom.com)** su Fandom — i mazzi dei
  personaggi di _Tag Force_, con licenza
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

Yu-Gi-Oh! e' un marchio di Konami Digital Entertainment. Questo e' un
progetto amatoriale senza scopo di lucro, non affiliato ne' approvato da
Konami, YGOPRODeck o Fandom; le immagini delle carte restano dei
rispettivi proprietari. Se rappresenti uno di questi soggetti e vuoi che
qualcosa venga rimosso, apri una issue.

Codice sotto licenza [MIT](LICENSE).

---

Sviluppatori: le note tecniche sono in **[SVILUPPO.md](SVILUPPO.md)**.
