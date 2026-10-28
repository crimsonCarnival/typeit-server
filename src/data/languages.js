/**
 * Frequent words for words mode in languages other than English (which
 * uses the random-words package). Common vocabulary, accents included:
 * typing them is part of practising the language.
 */
const words = (list) => Object.freeze(list.normalize('NFC').split(/\s+/).filter(Boolean));

export const LANGUAGE_WORDS = Object.freeze({
  spanish: words(`
    de la que el en y a los se del las un por con no una su para es al lo como más
    pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta
    hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante
    ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho
    quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te
    ti tu tus ellas vosotros os mío mía tuyo suyo nuestro casa tiempo vida día mundo
    año trabajo agua ciudad parte noche mujer hombre país forma caso grupo lugar nombre
    hora historia mano camino amigo madre padre libro escuela calle puerta ventana mesa
    comer beber hablar vivir pensar mirar llegar dejar seguir encontrar llamar venir
    sentir volver tomar conocer creer saber poder querer hacer decir ver dar ir bueno
    nuevo grande pequeño mejor primero último largo cierto mismo alto feliz rápido
  `),
  french: words(`
    le de un être et à il avoir ne je son que se qui ce dans en du elle au pour pas
    vous par sur faire plus dire me on mon lui nous comme mais pouvoir avec tout y
    aller voir en bien où sans tu ou leur homme si deux mari moi vouloir te femme
    venir quand grand celui notre devoir là jour prendre même votre tout rien petit
    encore aussi quelque dont tout mer trouver donner temps ça peu même falloir sous
    parler alors main chose ton mettre vie savoir yeux passer autre après regarder
    toujours puis jamais cela aimer non heure croire cent monde donc enfant fois
    seul autour pays maison porte livre école ville rue nuit soleil eau terre ciel
    ami père mère frère sœur travail histoire question raison idée moment matin soir
    beau bon nouveau premier dernier long haut jeune vieux heureux vite doucement
  `),
  german: words(`
    der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als
    auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie
    einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein
    wurde sei können schon wenn ihr ich du wir Zeit Jahr Mensch Tag Haus Welt Leben
    Hand Frau Mann Kind Stadt Land Arbeit Weg Wasser Schule Buch Freund Mutter Vater
    Tür Fenster Tisch Straße Nacht Morgen Abend Frage Antwort Geschichte Sprache
    gehen kommen sehen geben machen sagen wissen nehmen finden denken stehen bleiben
    sprechen lesen schreiben spielen arbeiten wohnen lernen essen trinken schlafen
    gut neu groß klein lang alt jung schnell langsam schön richtig wichtig möglich
    heute morgen immer nie oft hier dort jetzt dann wieder sehr gern zusammen
  `),
  portuguese: words(`
    de a o que e do da em um para é com não uma os no se na por mais as dos como mas
    foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo
    pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles
    estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia
    seja qual será nós tenho lhe deles essas esses pelas este fosse dele tu te casa
    tempo vida dia mundo ano trabalho água cidade noite mulher homem país lugar nome
    hora história mão caminho amigo mãe pai livro escola rua porta janela mesa comer
    beber falar viver pensar olhar chegar deixar seguir encontrar chamar vir sentir
    voltar tomar conhecer saber poder querer fazer dizer ver dar ir bom novo grande
    pequeno melhor primeiro último longo alto feliz rápido sempre nunca hoje amanhã
  `),
  italian: words(`
    di e il la che a per in un è non una sono mi si con ma come lo ho le se del della
    io ti da cosa più questo al bene tu mio anche quando lui no lei fare me ci già
    tutto essere perché qui solo sei dove molto ora suo noi te chi ancora fatto sempre
    nel stato voi così prima casa tempo vita giorno mondo anno lavoro acqua città notte
    donna uomo paese parte luogo nome ora storia mano strada amico madre padre libro
    scuola porta finestra tavolo mangiare bere parlare vivere pensare guardare arrivare
    lasciare seguire trovare chiamare venire sentire tornare prendere conoscere sapere
    potere volere dire vedere dare andare buono nuovo grande piccolo migliore primo
    ultimo lungo alto felice veloce oggi domani mai spesso qui là adesso poi insieme
  `),
});

export const WORD_LANGUAGES = Object.freeze(['english', ...Object.keys(LANGUAGE_WORDS)]);
