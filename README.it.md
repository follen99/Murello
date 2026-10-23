<div align="center">

<img src="assets/icon.svg" width="72" alt="">

# Murello

**Dalla pianta disegnata su draw.io a una casa 3D da arredare, direttamente nel browser.**

Disegna casa tua su [draw.io](https://app.diagrams.net), scrivi le misure sui muri, importala
e prova i mobili prima di comprarli: dimensioni, passaggi e come verrà davvero.

[**Apri l'app**](https://follen99.github.io/Murello/) · [Prova l'esempio](https://follen99.github.io/Murello/?example=appartamento) · [Read in English](README.md)

![Nessuna build](https://img.shields.io/badge/build-nessuna-30353b)
![three.js r186](https://img.shields.io/badge/three.js-r186-30353b)
![GitHub Pages](https://img.shields.io/badge/hosting-GitHub%20Pages-30353b)
![Licenza MIT](https://img.shields.io/badge/licenza-MIT-e9a92b)

<img src="docs/img/hero.webp" alt="Murello: pianta 2D e vista 3D di un appartamento arredato" width="100%">

</div>

---

## Cosa fa

- **Importa le piante di draw.io** (`.drawio` / `.xml`, compresse o no; più pagine = più piani). Le stanze possono essere rettangoli, i muri linee o spezzate, porte e finestre possono arrivare dalla libreria *Floorplan* di draw.io.
- **Le tue misure sono la verità.** Il disegno dà solo la topologia; le lunghezze scritte sui muri danno la geometria reale. Murello ti dice **quale muro devi ancora misurare** e **quali misure non tornano**, prima di costruire la casa.
- **Mostra la casa in 2D e in 3D** con ombre morbide, pavimenti con texture, finestre con telaio, porte con anta e un cursore per "tagliare" i muri e guardare dentro come in una casa delle bambole.
- **Modifica dei muri in 3D**: clicchi un muro e aggiungi finestre, porte, varchi, quadri, mensole, TV, termosifoni, specchi… sul lato e nel punto in cui hai cliccato.
- **Libreria di mobili + editor.** 36 modelli parametrici (divani, letti, cucine, bagno…), tutti ridimensionabili. Crea i tuoi con blocchi e cilindri, usando espressioni come `w/2 - 0.05`, oppure partendo da uno schizzo visto dall'alto disegnato su draw.io.
- **Controlla gli spazi**: sovrapposizioni, mobili dentro i muri, porte che non si aprono, finestre coperte, distanze dall'ostacolo più vicino mentre trascini, metro e mappa dei passaggi.
- **Arredo automatico**: posiziona i mobili di una stanza ottimizzando una funzione obiettivo pesata — cinque preset illustrati, pesi regolabili e criteri tuoi in JavaScript.
- **Salvataggio e andata/ritorno**: salvataggio automatico nel browser, esportazione/importazione nel formato `.murello.json` ed **esportazione verso draw.io** per continuare a modificare la pianta lì e reimportarla senza perdere i mobili.
- **Desktop e mobile**: l'interfaccia riconosce il dispositivo e attiva o disattiva le funzioni specifiche.

Tutto gira nel tuo browser. Nessun account, nessun server, nessun caricamento di file.

## Come funziona

```
draw.io ──► import ──► riconoscimento ──► controllo misure ──► casa 2D + 3D ──► mobili, verifiche, arredo automatico
   ▲                                                                                       │
   └────────────────────────── esporta in draw.io  ◄──── .murello.json ◄───────────────────┘
```

<img src="docs/img/import-check.webp" alt="Import: la misura mancante è evidenziata sull'anteprima, le misure incoerenti sono elencate" width="100%">

### 1. Disegna su draw.io

| Disegni | Murello capisce |
|---|---|
| Una **linea** o spezzata | un muro (una linea con le frecce a entrambi i capi è una **quota**) |
| Un **rettangolo** | una stanza; i suoi lati diventano muri |
| `3.40`, `3,40`, `340 cm`, `3m40` su una linea (doppio clic) | la lunghezza del muro |
| `Cucina 4x3,5` dentro una stanza | nome + larghezza × profondità |
| `h=2,70` | altezza della stanza o del muro |
| `sp=30` | spessore del muro (30 cm) |
| Un testo con solo un numero vicino a un muro | la lunghezza di quel muro |
| Porte, finestre, letti, divani… della libreria *Floorplan* | porte, finestre, mobili |
| Un testo `murello: misure=asse h=2,7 est=30 int=10` | opzioni per tutto il file (modo di misura, altezza, spessore esterni/interni) |
| Ogni **pagina** | un piano della casa |

I numeri senza unità si leggono in automatico: `340` → centimetri, `3,4` → metri (si può cambiare).

### 2. Importa e controlla le misure

Il solutore aggancia gli estremi dei muri negli angoli, divide i muri ai giunti a T e poi risolve **X e Y separatamente** con un union-find pesato (con i muri ortogonali il problema diventa lineare; i muri inclinati si risolvono appena una delle due proiezioni è nota). Ogni misura — etichette sui muri, `L×P` delle stanze, quote, testi vicini, larghezza delle porte, le tue risposte — diventa un vincolo tra due angoli.

- **Misure mancanti**: se una parte della pianta non è collegata al resto, Murello evidenzia il muro esatto da misurare (preferendo muri esterni e lunghi) e mostra la stima ricavata dal disegno. Puoi anche accettare le stime per un'anteprima veloce.
- **Misure incoerenti**: quando un giro di misure non si chiude (es. `1,70 + 0,80 + 1,60 + …` ≠ `8,00`), elenca tutte le misure coinvolte così puoi correggere o ignorare quella sbagliata.
- **Nette o in asse**: di default le misure sono *nette* (tra le facce dei muri, quello che misuri col metro) e metà dello spessore dei muri viene aggiunta in automatico. Puoi passare a *in asse* nella procedura di import o nel file.

### 3. Forme sconosciute: ignora o assegna una categoria

Le forme che Murello non conosce si possono **ignorare** (se una interrompe un muro, il muro viene chiuso e la porta la aggiungi dopo in 3D) oppure **assegnare a una categoria** (muro, stanza, porta, finestra, varco, mobile, pilastro, scala, quota, testo). Con *Ricorda* diventa una regola.

## Categorie e regole (estendibili senza toccare il codice)

Le regole trasformano le forme di draw.io in elementi della casa. Le tue regole vengono prima di quelle incluse. Si creano in **Categorie** con un modulo…

```text
Nome: Termosifone    Quando: Forma è "mxgraph.floorplan.radiator"    Diventa: Mobile (modello termosifone, alto 0,6, a 0,12 da terra)
```

…oppure, per la massima libertà, con una funzione JavaScript (gira solo sul tuo dispositivo):

```js
// cell: { shape, style, label, attrs, isEdge, width, height }
return cell.shape.includes('fireplace') || /camino/i.test(cell.label);
```

Regole, modelli di mobili e criteri dell'arredo automatico viaggiano insieme in un **file di libreria** condivisibile (`murello-libreria.json`). Il codice che arriva da file importati resta disattivato finché non lo rivedi e lo approvi.

Per aggiungere nel codice un *tipo* di elemento completamente nuovo, registralo in [`js/categories/registry.js`](js/categories/registry.js) (`KINDS`) e insegna a [`js/io/plan-extract.js`](js/io/plan-extract.js) come leggerlo.

## Mobili

I modelli sono semplici dati: quelli inclusi, i tuoi e quelli importati usano lo stesso formato.

```js
{
  id: 'panca', name: { it: 'Panca', en: 'Bench' }, cat: 'custom', color: '#b8875a',
  params: { w: 1.2, d: 0.35, h: 0.45 }, tags: ['wall', 'seat'],
  parts: [
    { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.01, m: 'main' },
    { rep: 'max(2, round(w/0.6))', s: 'box', x: '-w/2 + w/n*(i+0.5)', y: 0, z: 0, w: 0.04, h: 'h-0.04', d: 'd-0.04', m: 'dark' }
  ]
}
```

- `s`: `box` (arrotondato con `r`), `cyl` (rastremato con `tp`, `ax: 'z'` per orientarlo in avanti), `sph`.
- `x`, `z` dal centro dell'ingombro, `y` dal pavimento; `w h d` dimensioni. Ogni campo può essere un'espressione di `w d h` (misure del mobile), `H` (altezza del piano), `i n` (indice/numero di ripetizioni) con `min max round floor ceil abs sqrt sin cos atan PI`: le espressioni sono filtrate, non eseguite liberamente.
- Materiali: `main` (colore del mobile), `soft`, `accent`, `wood`, `dark`, `white`, `metal`, `black`, `glass`, `ceramic`, `mattress`, `leaf`, `pot`, `counter`, `screen`.
- I tag guidano verifiche e arredo automatico: `wall` (a muro), `tall`, `seat`, `light`, `low`, `center`, `small`, `hanging`, `flat`.

L'editor mostra il modello in 3D e dall'alto mentre lo modifichi. Può anche partire da uno **schizzo draw.io visto dall'alto**: ogni rettangolo o ellisse diventa una parte, proporzionale alle misure totali (`120x60` in un'etichetta fissa la scala, `h=0,75` l'altezza).

## Verifiche

- **Sovrapposizioni** (tenendo conto dell'altezza: un pensile sopra una base va bene, una sedia infilata sotto il suo tavolo va bene), **mobile dentro un muro**, **porta bloccata**, **finestra coperta**, **fuori dalle stanze**.
- **Quote automatiche** da ogni lato del mobile selezionato all'ostacolo più vicino, colorate secondo il passaggio *minimo* (60 cm di default) e *comodo* (90 cm), in 2D e in 3D.
- **Metro** con aggancio ad angoli e pareti, in 2D e in 3D.
- **Mappa dei passaggi**: il pavimento raggiungibile dalle porte da una persona larga quanto il passaggio minimo (verde) e lo spazio libero ma irraggiungibile (rosso).

<img src="docs/img/3d-cut.webp" alt="Vista 3D con i muri tagliati a 2,1 m" width="100%">

## Arredo automatico

L'ottimizzatore gira in un **Web Worker** (la pagina resta reattiva) e usa il simulated annealing con mosse "da arredatore": appoggia al muro, metti accanto al compagno (comodino vicino al letto, sedie attorno al tavolo, divano rivolto alla TV), scambia, ruota, sposta di poco. Massimizza

```
J = Σ pesoᵢ · (±criterioᵢ) − 60 · vincoli
```

dove ogni criterio incluso vale tra `0` e `1`, `+` per *massimizza*, `−` per *minimizza*, e i vincoli sono sovrapposizioni, uscire dalla stanza e bloccare l'apertura delle porte.

| Criterio | Premia |
|---|---|
| Passaggi liberi | pavimento raggiungibile dalle porte con il passaggio minimo |
| Spazio aperto al centro | un grande spazio libero continuo |
| Mobili contro il muro | schienale dei mobili `wall` appoggiato al muro |
| Vicino alle finestre | scrivanie, tavoli e sedute vicino alla luce |
| Finestre coperte (min) | mobili alti davanti alle finestre |
| Abbinamenti | comodino↔letto, sedie↔tavolo, divano↔TV, sedia↔scrivania |
| Conversazione | sedute rivolte l'una all'altra a 1,2–3,5 m |
| Equilibrio visivo | "peso" distribuito attorno al centro |
| Ingressi sgombri | una fascia libera davanti a ogni porta |
| Dispersione (min) | mobili raggruppati |

I preset — **Equilibrato**, **Massimo spazio**, **Luce naturale**, **Conviviale**, **Accessibile** (passaggi da 90 cm) — hanno ognuno un'illustrazione e impostano i pesi; poi puoi regolare ogni cursore o invertire massimizza/minimizza. Aggiungi criteri tuoi in JavaScript e provali sulla stanza attuale:

```js
// TV lontana dalle finestre (riflessi). Restituisci 0..1, più alto è meglio.
const tv = ctx.items.find(i => i.model.startsWith('tv'));
if (!tv || !ctx.windows.length) return 1;
const d = Math.min(...ctx.windows.map(w => h.dist(tv, w.center)));
return h.clamp01(d / 4);
```

Ottieni fino a tre proposte diverse con il punteggio di ogni criterio, in anteprima sulla pianta; *Usa questa* la applica (e Annulla la toglie).

<img src="docs/img/autofurnish.webp" alt="Pannello dell'arredo automatico con i preset illustrati e una proposta per la camera" width="100%">

## Desktop e mobile

<img src="docs/img/mobile.webp" alt="Murello su telefono: vista 3D e pianta 2D con l'ispettore a scomparsa" width="70%">

Il dispositivo viene riconosciuto dal tipo di puntatore e dalla dimensione dello schermo (si può forzare nelle Impostazioni). Alcune funzioni esistono solo dove hanno senso:

| Funzione | Desktop | Mobile |
|---|:-:|:-:|
| 2D e 3D affiancate | ✓ | |
| Scorciatoie da tastiera, evidenziazione al passaggio del mouse, menu col tasto destro | ✓ | |
| Trascinare i mobili dalla libreria sulla pianta | ✓ | |
| Pannelli e ispettore a scomparsa dal basso | | ✓ |
| Rotazione dei mobili a due dita (scatti di 15°) | | ✓ |
| Vibrazione agli agganci | | ✓ |
| Ombre e risoluzione più leggere sui dispositivi poco potenti | | ✓ |

Scorciatoie: `1` `2` `3` viste · `R` ruota · `Canc` elimina · `Ctrl+D` duplica · frecce sposta di 1 cm (`Shift` 10 cm) · `M` metro · `W` disegna muri · `F` inquadra · `Ctrl+Z`/`Ctrl+Y` · `Ctrl+S` esporta · `Spazio`+trascina sposta la pianta · `Alt` mentre trascini toglie l'aggancio · `?` guida.

## Salvataggio e formati

- **Salvataggio automatico** in `localStorage` (progetto, libreria e impostazioni restano sul dispositivo).
- **`.murello.json`**: il progetto completo (piani, muri con aperture e decorazioni, stanze, mobili, modelli personalizzati usati). Reimportalo per riprendere esattamente da dove eri.
- **Esportazione draw.io**: una pagina per piano, lunghezze scritte sui muri (in asse), porte/finestre come forme Floorplan, mobili come forme con etichetta. I dati specifici di Murello sono salvati in proprietà personalizzate (`murello_kind`, `murello_data`, visibili su draw.io in *Modifica ▸ Modifica dati*), quindi draw.io → Murello → draw.io non perde nulla. Quando reimporti una pianta aggiornata puoi scegliere di **aggiornare solo i muri e tenere i mobili**.

## Pubblicazione su GitHub Pages

1. Crea una repository pubblica (es. `murello`) e carica questi file sul branch `main`.
2. *Settings ▸ Pages ▸ Build and deployment*: **Deploy from a branch**, branch `main`, cartella `/ (root)`.
3. Apri `https://follen99.github.io/Murello/`.

Non serve nessuna build: il sito è fatto di moduli ES e di una copia minificata di three.js. Il file `.nojekyll` evita che GitHub elabori i file.

## In locale

```bash
python3 -m http.server 8080      # va bene qualsiasi server statico; i moduli ES richiedono http://, non file://
# apri http://localhost:8080
```

Test (parser, solutore, andata e ritorno) in Node:

```bash
npm install     # installa solo linkedom, un parser DOM per Node
npm test
node tests/debug-solve.mjs examples/bilocale-misure-mancanti.drawio   # mostra cosa vede il solutore
```

## Struttura

```
index.html              guscio dell'app, icone, import map
css/app.css             token di design, layout desktop + mobile, tema chiaro/scuro
js/main.js              app: viste, pannelli, azioni, scorciatoie, salvataggio
js/core/                stato + annulla/ripeti, traduzioni IT/EN, dispositivo, geometria, persistenza
js/io/                  parser draw.io, lettura etichette, estrazione pianta, solutore misure,
                        costruzione progetto, export draw.io, formato nativo
js/categories/          tipi di elemento e regole di riconoscimento
js/model/               geometria derivata: muri raccordati, stanze (facce planari), superfici
js/view2d/              pianta 2D su canvas (modifica, aggancio, quote, mappa passaggi)
js/view3d/              visualizzatore three.js (render su richiesta), muri/pavimenti/aperture/decori, materiali
js/furniture/           libreria parametrica, espressioni sicure, costruzione mesh
js/tools/               collisioni, distanze, aperture porte, aggancio, griglia di percorribilità
js/autofurnish/         criteri + preset, contesto della stanza, worker di ottimizzazione
js/ui/                  procedura di import, ispettore, pannelli, regole, editor modelli
vendor/three/           three.js r186 (MIT), minificato
examples/               file draw.io di esempio
tests/                  test Node
```

## Perché queste tecnologie

- **JavaScript puro + moduli ES, niente framework né build**: fai push ed è online; facile da leggere e modificare.
- **three.js** per WebGL, incluso nella repository (~200 kB compressi, la parte più pesante) e **caricato solo quando serve**: la pianta 2D funziona prima che arrivi.
- **Render su richiesta**: il 3D disegna solo quando qualcosa cambia, a pagina ferma non consuma nulla.
- Geometrie unite: tutti i muri di un piano sono un'unica mesh, ogni mobile una mesh per materiale.
- **Texture procedurali** (canvas) invece di immagini da scaricare.
- L'ottimizzatore gira in un **Web Worker**.

## Privacy

I file vengono letti nel browser e non vengono mai caricati. Le uniche richieste di rete sono i file del sito e il foglio di stile di Google Fonts per il carattere dell'interfaccia (togli il `<link>` in `index.html` per usare il font di sistema).

## Idee per il futuro

Modalità passeggiata in prima persona · muri curvi · tetti e soffitti inclinati · scale che collegano i piani · import di mobili glTF · link di sola lettura da condividere.

## Licenza

[MIT](LICENSE). three.js è © degli autori di three.js, licenza MIT ([vendor/three/LICENSE](vendor/three/LICENSE)).
