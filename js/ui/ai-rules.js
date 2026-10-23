// Rules to hand to an AI assistant so that the draw.io file it generates imports into Murello
// without wrong walls or inconsistent lengths. Keep in sync with io/plan-extract.js, io/labels.js,
// io/solver.js and categories/registry.js.

const EXAMPLE = `<mxfile host="Murello">
  <diagram id="p1" name="Piano terra">
    <mxGraphModel grid="1" gridSize="10" page="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="meta" value="murello: unita=cm misure=asse h=270 est=30 int=10" style="text;html=1;" vertex="1" parent="1">
          <mxGeometry x="0" y="-80" width="420" height="20" as="geometry"/>
        </mxCell>
        <mxCell id="w1" value="400" style="endArrow=none;html=1;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry"><mxPoint x="0" y="0" as="sourcePoint"/><mxPoint x="400" y="0" as="targetPoint"/></mxGeometry>
        </mxCell>
        <mxCell id="w2" value="300" style="endArrow=none;html=1;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry"><mxPoint x="400" y="0" as="sourcePoint"/><mxPoint x="400" y="300" as="targetPoint"/></mxGeometry>
        </mxCell>
        <mxCell id="w3" value="400" style="endArrow=none;html=1;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry"><mxPoint x="400" y="300" as="sourcePoint"/><mxPoint x="0" y="300" as="targetPoint"/></mxGeometry>
        </mxCell>
        <mxCell id="w4" value="300" style="endArrow=none;html=1;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry"><mxPoint x="0" y="300" as="sourcePoint"/><mxPoint x="0" y="0" as="targetPoint"/></mxGeometry>
        </mxCell>
        <mxCell id="d1" value="80" style="shape=mxgraph.floorplan.doorLeft;aspect=fixed;html=1;rotation=0;" vertex="1" parent="1">
          <mxGeometry x="50" y="220" width="80" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="f1" value="120 dav=90 h=140" style="shape=mxgraph.floorplan.window;html=1;" vertex="1" parent="1">
          <mxGeometry x="140" y="-5" width="120" height="10" as="geometry"/>
        </mxCell>
        <mxCell id="n1" value="Soggiorno" style="text;html=1;" vertex="1" parent="1">
          <mxGeometry x="150" y="130" width="100" height="20" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const it = `REGOLE PER GENERARE UN FILE DRAW.IO LEGGIBILE DA MURELLO
Murello trasforma una pianta draw.io in una casa 3D. Il disegno dà la topologia (quali muri esistono e come si collegano), le etichette danno le misure vere. Segui queste regole alla lettera: ogni deviazione produce muri sbagliati o misure incoerenti.

1. FORMATO
- Restituisci un file .drawio in XML NON compresso: <mxfile><diagram name="…"><mxGraphModel><root>…</root></mxGraphModel></diagram></mxfile>.
- In <root> metti sempre <mxCell id="0"/> e <mxCell id="1" parent="0"/>; tutti gli elementi hanno parent="1" (niente gruppi, niente contenitori). Gli id devono essere unici.
- Ogni <diagram> (pagina) è un piano della casa. Una casa su un piano = una sola pagina.

2. SCALA E IMPOSTAZIONI
- Usa 1 px = 1 cm. Asse x verso destra, asse y verso il basso.
- In ogni pagina aggiungi questo testo (fuori dalla pianta):
  value="murello: unita=cm misure=asse h=270 est=30 int=10" style="text;html=1;"
  unita=cm: i numeri senza unità sono centimetri (senza, "19" verrebbe letto come 19 m).
  misure=asse: le lunghezze scritte vanno da centro muro a centro muro.
  h = altezza dei muri, est / int = spessore dei muri esterni / interni (cm).
- Ogni linea che disegni è l'asse (la linea centrale) di un muro.

3. MURI
- Ogni muro è una linea (edge) senza frecce: style="endArrow=none;html=1;" edge="1", con <mxGeometry relative="1"> e i due punti sourcePoint / targetPoint. Niente source/target verso altre forme.
- value = la lunghezza ESATTA della linea disegnata, in cm, solo il numero (es. value="340"). Se il disegno e i numeri coincidono, tutte le misure tornano automaticamente.
- Solo muri orizzontali (stessa y ai due capi) o verticali (stessa x). Un muro inclinato è ammesso solo se scrivi anche l'angolo: value="141 45°".
- Due muri che si toccano devono avere il punto di contatto con coordinate IDENTICHE. Un muro che arriva a metà di un altro (giunto a T) va bene: Murello lo divide da solo.
- Il perimetro di ogni stanza deve essere un anello chiuso di muri.
- VIETATO: linee duplicate o sovrapposte; scalini o raccordi diagonali di pochi px; muri lunghi meno di 5 cm; linee tratteggiate, di aiuto, di richiamo delle quote o di separazione: OGNI linea senza frecce diventa un muro, qualunque sia lo stile.
- Opzioni nell'etichetta: "sp=30" spessore diverso dal predefinito, "h=100" altezza diversa (es. parapetto di un balcone: value="250 h=100 sp=10").
- Etichette ammesse: solo numeri (interi o con virgola decimale) e le opzioni sopra. VIETATO: "≈215", "circa", "32 (?)", "95 + 50", note, nomi. Se una misura non è nota lascia value="" e disegna la linea con la lunghezza stimata: Murello la chiederà o la stimerà dal disegno.

4. PORTE, FINESTRE, VARCHI
- Il muro prosegue continuo sotto porte e finestre: non interromperlo. La forma si appoggia sopra.
- Porta: style="shape=mxgraph.floorplan.doorLeft;aspect=fixed;html=1;rotation=R;" (oppure doorRight, doorDouble), quadrata: width = height = larghezza della porta (es. 80), value="80".
  Il lato della forma che sta sul muro dipende dalla rotazione: R=0 lato in basso (la porta si apre verso l'alto), R=180 lato in alto, R=90 lato sinistro, R=270 lato destro.
  Muro orizzontale a quota Y, porta da x1 larga L: apertura verso l'alto → x=x1 y=Y-L R=0; verso il basso → x=x1 y=Y R=180.
  Muro verticale a ascissa X, porta da y1 larga L: verso destra → x=X y=y1 R=90; verso sinistra → x=X-L y=y1 R=270.
- Finestra: style="shape=mxgraph.floorplan.window;html=1;", alta 10 e centrata sulla linea del muro, value="L dav=90 h=140" (larghezza, davanzale, altezza in cm).
  Muro orizzontale a quota Y: x=x1 y=Y-5 width=L height=10. Muro verticale a ascissa X: x=X-L/2 y=y1+L/2-5 width=L height=10 rotation=90.
- Varco senza porta: un rettangolo style="rounded=0;html=1;" largo quanto il varco e spesso 10, centrato sul muro come una finestra, value="varco 90".

5. STANZE E TESTI
- Nome della stanza: UN solo testo style="text;html=1;" dentro la stanza, es. value="Cucina". Facoltativo: "h=260" per un'altezza diversa.
- VIETATO nei testi: numeri da soli (un testo "4" vicino a un muro diventa la lunghezza di quel muro), note, legende, didascalie, frecce. Un secondo testo nella stessa stanza può diventarne il nome.
- Balconi e terrazzi: disegnali come stanze chiuse con muri bassi (parapetto h=100 sp=10) e il nome "Balcone".

6. QUOTE (FACOLTATIVE)
- Solo se servono: una linea con frecce a entrambi i capi, style="startArrow=classic;endArrow=classic;html=1;", value = distanza in cm. I due capi devono avere la stessa x (o la stessa y) di due angoli di muro. Nessuna linea di richiamo.
- Ogni misura ridondante (quota, testo, muro) deve coincidere esattamente con le altre.

7. MOBILI (FACOLTATIVI)
- Usa le forme mxgraph.floorplan.* (bed_double, sofa, table, chair, toilet, bathtub, sink_1, refrigerator…) con width/height = ingombro reale in cm. Puoi anche ometterli: si aggiungono dopo in Murello.

8. DALLE MISURE COL METRO ALLE COORDINATE
- Le misure prese col metro sono nette (da parete a parete). Lungo una direzione, l'asse di un muro dista dalla faccia metà del suo spessore: lunghezza in asse = misura netta + metà spessore del muro a un capo + metà spessore del muro all'altro capo.
- Calcola prima le coordinate di tutti gli angoli, poi disegna, poi scrivi in ogni value la lunghezza della linea.

9. CONTROLLO FINALE (FALLO PRIMA DI RISPONDERE)
- Ogni value di muro = |x2-x1| oppure |y2-y1| della sua linea.
- Per ogni stanza la somma dei muri di un lato = somma dei muri del lato opposto.
- Nessun capo di muro isolato tranne dove il muro finisce davvero; nessun duplicato; nessuna linea tratteggiata.
- Unità sempre cm, testo "murello:" presente in ogni pagina.

ESEMPIO (stanza 400 × 300 in asse con porta da 80 e finestra da 120):
${EXAMPLE}`;

const en = `RULES FOR GENERATING A DRAW.IO FILE THAT MURELLO CAN READ
Murello turns a draw.io floor plan into a 3D house. The drawing gives the topology (which walls exist and how they connect), the labels give the real lengths. Follow these rules to the letter: any deviation produces wrong walls or inconsistent lengths.

1. FORMAT
- Return an UNCOMPRESSED XML .drawio file: <mxfile><diagram name="…"><mxGraphModel><root>…</root></mxGraphModel></diagram></mxfile>.
- In <root> always put <mxCell id="0"/> and <mxCell id="1" parent="0"/>; every element has parent="1" (no groups, no containers). Ids must be unique.
- Each <diagram> (page) is one floor of the house. A single-storey house = one page.

2. SCALE AND SETTINGS
- Use 1 px = 1 cm. x axis to the right, y axis downwards.
- On every page add this text (outside the plan):
  value="murello: unita=cm misure=asse h=270 est=30 int=10" style="text;html=1;"
  unita=cm: numbers without a unit are centimetres (otherwise "19" would be read as 19 m).
  misure=asse: written lengths go from wall centre to wall centre.
  h = wall height, est / int = outer / inner wall thickness (cm).
- Every line you draw is the axis (centre line) of a wall.

3. WALLS
- Every wall is a line (edge) without arrows: style="endArrow=none;html=1;" edge="1", with <mxGeometry relative="1"> and the two points sourcePoint / targetPoint. No source/target pointing to other shapes.
- value = the EXACT length of the drawn line, in cm, number only (e.g. value="340"). When drawing and numbers agree, every length adds up automatically.
- Horizontal walls only (same y at both ends) or vertical (same x). A slanted wall is allowed only if you also write its angle: value="141 45°".
- Two walls that touch must share IDENTICAL coordinates at the contact point. A wall ending in the middle of another (T junction) is fine: Murello splits it.
- The perimeter of every room must be a closed loop of walls.
- FORBIDDEN: duplicate or overlapping lines; steps or diagonal joints a few px long; walls shorter than 5 cm; dashed, helper, extension or separator lines: EVERY line without arrows becomes a wall, whatever its style.
- Label options: "sp=30" thickness other than the default, "h=100" different height (e.g. a balcony parapet: value="250 h=100 sp=10").
- Allowed labels: numbers only (integers or with a decimal comma) and the options above. FORBIDDEN: "≈215", "about", "32 (?)", "95 + 50", notes, names. If a length is unknown leave value="" and draw the line at its estimated length: Murello will ask for it or estimate it from the drawing.

4. DOORS, WINDOWS, OPENINGS
- The wall runs continuously under doors and windows: do not break it. The shape sits on top.
- Door: style="shape=mxgraph.floorplan.doorLeft;aspect=fixed;html=1;rotation=R;" (or doorRight, doorDouble), square: width = height = door width (e.g. 80), value="80".
  Which side of the shape lies on the wall depends on the rotation: R=0 bottom side (the door opens upwards), R=180 top side, R=90 left side, R=270 right side.
  Horizontal wall at height Y, door from x1 of width L: opening upwards → x=x1 y=Y-L R=0; downwards → x=x1 y=Y R=180.
  Vertical wall at X, door from y1 of width L: to the right → x=X y=y1 R=90; to the left → x=X-L y=y1 R=270.
- Window: style="shape=mxgraph.floorplan.window;html=1;", 10 high and centred on the wall line, value="L dav=90 h=140" (width, sill, height in cm).
  Horizontal wall at Y: x=x1 y=Y-5 width=L height=10. Vertical wall at X: x=X-L/2 y=y1+L/2-5 width=L height=10 rotation=90.
- Opening without a door: a rectangle style="rounded=0;html=1;" as wide as the opening and 10 thick, centred on the wall like a window, value="varco 90".

5. ROOMS AND TEXTS
- Room name: ONE text style="text;html=1;" inside the room, e.g. value="Kitchen". Optional: "h=260" for a different height.
- FORBIDDEN in texts: lone numbers (a text "4" near a wall becomes that wall's length), notes, legends, captions, arrows. A second text in the same room may become its name.
- Balconies and terraces: draw them as closed rooms with low walls (parapet h=100 sp=10) named "Balcony".

6. DIMENSION LINES (OPTIONAL)
- Only if needed: a line with arrows at both ends, style="startArrow=classic;endArrow=classic;html=1;", value = distance in cm. Both ends must share the x (or the y) of two wall corners. No extension lines.
- Every redundant length (dimension, text, wall) must match the others exactly.

7. FURNITURE (OPTIONAL)
- Use mxgraph.floorplan.* shapes (bed_double, sofa, table, chair, toilet, bathtub, sink_1, refrigerator…) with width/height = real footprint in cm. You may also leave them out: they can be added later in Murello.

8. FROM TAPE MEASUREMENTS TO COORDINATES
- Tape measurements are clear lengths (face to face). Along one direction, a wall's axis lies half its thickness away from its face: centre-line length = clear length + half the thickness of the wall at one end + half the thickness of the wall at the other end.
- Compute the coordinates of every corner first, then draw, then write each line's length in its value.

9. FINAL CHECK (DO IT BEFORE ANSWERING)
- Every wall value = |x2-x1| or |y2-y1| of its line.
- For every room, the walls on one side add up to the walls on the opposite side.
- No loose wall ends except where a wall really ends; no duplicates; no dashed lines.
- Units always cm, a "murello:" text on every page.

EXAMPLE (a 400 × 300 centre-line room with an 80 door and a 120 window):
${EXAMPLE}`;

export const AI_RULES = { it, en };
