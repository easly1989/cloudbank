<p align="center">
  <img src="docs/img/logo.svg" alt="Logo di CloudBank" width="96" height="96" />
</p>

<h1 align="center">CloudBank</h1>

<p align="center">
  <strong>I tuoi soldi, sul tuo server.</strong><br />
  Un gestore di finanze personali gratuito e sul web: un port per il browser, scritto da zero, di <a href="https://www.gethomebank.org/">HomeBank</a>.
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>Italiano</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <a href="https://p01--cloudbank--7dcjw6mlmtky.code.run/"><img src="https://img.shields.io/badge/Prova_la_demo-2457D6?style=for-the-badge" alt="Prova la demo" height="34" /></a>
</p>

<p align="center">
  <sub>Dati inventati in un account usa e getta, cancellato quando smetti di usarlo. <a href="docs/demo.md">Cos'è la demo</a> (in inglese).</sub>
</p>

<p align="center">
  <a href="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml"><img src="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml/badge.svg" alt="Stato della CI" /></a>
  <a href="https://github.com/easly1989/cloudbank/issues"><img src="https://img.shields.io/github/issues/easly1989/cloudbank" alt="Issue aperte" /></a>
  <a href="https://github.com/easly1989/cloudbank/pkgs/container/cloudbank"><img src="https://img.shields.io/badge/ghcr.io-cloudbank-2496ED?logo=docker&logoColor=white" alt="Immagine del container" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="Licenza: AGPL v3" /></a>
</p>

---

**CloudBank** è un gestore di finanze personali gratuito, da ospitare sul proprio server, che si usa dal browser: un port per il web, scritto da zero, dell'ottima applicazione desktop [HomeBank](https://www.gethomebank.org/). Punta a fare tutto ciò che fa HomeBank, ma pensato per il browser: un solo container Docker che fai girare tu, con i dati in un database SQLite su un volume che controlli tu.

**Provalo prima:** la [demo](https://p01--cloudbank--7dcjw6mlmtky.code.run/) è a un clic, senza registrazione, con un anno di dati inventati. Viene cancellata dopo due ore di inattività, quindi niente di ciò che ci metti resta.

## Perché

HomeBank è un'ottima app desktop, ma solo desktop. CloudBank porta lo stesso modo di lavorare (conti, un registro delle transazioni completo, transazioni programmate, budget, report ricchi e l'import da molti formati, compreso il file `.xhb` di HomeBank, in **lettura e scrittura**) in un'interfaccia web che raggiungi da qualsiasi dispositivo, tenendo i dati sul tuo server.

CloudBank è una **reimplementazione indipendente, clean-room**. Non copia né usa codice di HomeBank: dell'originale guarda solo il comportamento documentato e i formati dei file, e segue le versioni di HomeBank, presenti e future. CloudBank è distribuito con licenza **AGPL-3.0** (HomeBank è GPL-2+).

## Schermate

|                 Cruscotto                |          Registro: azioni su più righe selezionate          |
| :--------------------------------------: | :---------------------------------------------------------: |
| ![Cruscotto](docs/img/dashboard.png)     | ![Azioni su più righe nel registro](docs/img/register-bulk.png) |

|        Programmate: le bollette del mese su un calendario        |        Revisione: i possibili doppioni della sincronizzazione        |
| :------------------------------------------------------: | :---------------------------------------------------------: |
| ![Calendario delle programmate](docs/img/schedules.png)  | ![Revisione](docs/img/review.png)                           |

|      Budget: previsto e speso, la risposta per prima      |      Categorie: ogni elenco si modifica in un pannello accanto      |
| :--------------------------------------------------------: | :----------------------------------------------------------: |
| ![Budget](docs/img/budget.png)                              | ![Categorie](docs/img/categories.png)                         |

|                 Report interattivi                  |            Aspetto: tema, colore, barra laterale            |
| :-------------------------------------------------: | :------------------------------------------------: |
| ![Report](docs/img/reports.png)                     | ![Impostazioni](docs/img/settings.png)             |

|            Un cruscotto libero, su misura             |    Import ed export: `.xhb` di HomeBank, backup e ripristino    |
| :------------------------------------------------------: | :------------------------------------------------: |
| ![Personalizzare il cruscotto](docs/img/dashboard-customize.png) | ![Export](docs/img/export.png)             |

<sub>Le schermate usano i dati inventati della demo, in inglese.</sub>

## Funzioni

- **Conti e registro:** tutti i tipi di conto di HomeBank, ognuno nella sua valuta, con il saldo di oggi e quello futuro. Le transazioni si segnano verificate e riconciliate, con suddivisioni, tag e giroconti; il registro ha filtri, colonne a scelta, azioni su più righe, la ricerca e la riconciliazione con l'estratto conto.
- **Programmate e calendario:** le transazioni che tornano si registrano da sole, anche fino a tre mesi prima. Un calendario mostra le scadenze del mese con il loro stato, cosa resta da pagare e cosa aspetta te; modelli e regole di assegnazione compilano il resto. CloudBank trova anche i pagamenti che si ripetono senza una programmata, mostra quanto costa ognuna in un anno e mette le scadenze nel calendario del telefono.
- **Budget e report:** dove sono finiti i soldi, cosa è entrato e uscito, cosa hanno e avranno i conti, quanto costa un'auto; per mese, trimestre o anno, con viste salvate e download CSV e PNG.
- **Obiettivi e veicoli:** quanto hai messo da parte, quanto mettere ogni mese per arrivare in tempo e quanto resta libero; per ogni veicolo carburante, chilometri, costo al chilometro e consumi.
- **Import ed export:** `.xhb` di HomeBank, QIF, OFX/QFX, CSV e CAMT.053 (ISO 20022) in entrata, con un assistente; `.xhb`, QIF e CSV in uscita; backup e ripristino del portafoglio.
- **Sincronizzazione bancaria:** le transazioni nuove arrivano dalla banca, passano per le tue regole e si uniscono a quelle che hai già invece di duplicarsi. Con le tue credenziali, su [SimpleFIN](https://www.simplefin.org/), [Enable Banking](https://enablebanking.com/) (UE e Regno Unito) e, in prova, [Pluggy](https://pluggy.ai/) (America Latina).
- **Mail della banca:** CloudBank legge le notifiche dei pagamenti da una cartella di una casella: Outlook.com, Hotmail o Live accedendo a Microsoft, ogni altra via IMAP con una password per app. Uno schema creato evidenziando una mail vera trasforma ognuna in una transazione verificata, oppure la legge l'AI, dopo aver nascosto numeri di carta e IBAN. La sincronizzazione bancaria unisce la sua riga a quella della mail invece di duplicarla, e Revisione chiede delle mail che la banca non ha mai registrato. Solo in lettura, in ascolto mentre le mail arrivano, e solo da mittenti autenticati dal server di posta.
- **Multi-valuta e multi-utente:** cambi manuali od online (BCE), più utenti gestiti dall'amministratore, portafogli condivisi; l'app è in inglese e in italiano, e in tedesco, francese, spagnolo e portoghese brasiliano (beta).
- **Un cruscotto su misura:** in cima ciò che aspetta te, poi widget da mettere e ridimensionare dove vuoi, temi chiaro e scuro con il colore che preferisci, barra laterale e navigazione da riordinare.
- **Sicurezza:** autenticazione a due fattori, accesso con SSO (OIDC), token API revocabili e segreti cifrati nel database. Con un token, Home Assistant legge un riepilogo del portafoglio come sensori: scadenze, budget del mese, cosa aspetta in Revisione, e i saldi solo se li chiedi ([la guida](docs/home-assistant.md)).
- **App installabile:** CloudBank si installa sul telefono o sul computer come un'app, con le notifiche push delle scadenze, e avvisa quando c'è una versione nuova. Tenendo premuta l'icona trovi «Nuova spesa» e «Nuova entrata»; su Android, condividere con CloudBank la notifica della banca apre il modulo con il suo testo.
- **Notifiche dove le vedi:** una campanella su ogni pagina, e a scelta push, email, Matrix, Telegram, Discord, Slack, ntfy, Gotify o un webhook per Home Assistant. Scegli quali eventi arrivano dove (scadenze, sicurezza, problemi, soldi, riepiloghi) e quando, con un riepilogo giornaliero e le ore di silenzio ([la guida](docs/notifications.md)).
- **IA facoltativa, con la tua chiave:** spenta finché non la configuri, con un servizio compatibile con OpenAI o un modello sulla tua rete. Scrive un report su ogni mese (e, se vuoi, su ogni settimana e anno), propone budget da quello che spendi davvero, segnala abbonamenti rincarati, categorie cresciute, obiettivi in ritardo e transazioni insolite; suggerisce categorie e compila una transazione scritta a parole («caffè 3,50 ieri»); propone regole, compila in blocco le transazioni da categorizzare, ripulisce i nomi dei beneficiari, riconosce le colonne di un CSV mai visto, risponde alle domande sui tuoi soldi e legge la foto di uno scontrino. I numeri li calcola CloudBank, nulla si salva senza di te, e ogni funzione dice cosa invia ([la guida](docs/ai.md)).

## Avvio rapido

<!-- quick-start -->

Ti serve [Docker](https://docs.docker.com/get-docker/) con il plugin Compose.
Crea un `docker-compose.yml` (o copia [quello del repository](docker-compose.yml)):

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:main # latest stable release (see tags below)
    container_name: cloudbank
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Set to "false" only for a plain-HTTP LAN install without TLS in front.
      CB_SECURE_COOKIES: "false"
    volumes:
      - cloudbank-data:/data

volumes:
  cloudbank-data:
```

Poi avvialo e apri l'app:

```bash
docker compose up -d
# open http://localhost:8080 and complete the first-run admin setup
```

Tutta l'installazione è questa: un container, nessun database esterno. I dati
stanno nel volume `cloudbank-data` (un database SQLite sotto `/data`). Per il
backup copia quel volume, oppure usa il **backup del portafoglio** nell'app
(Impostazioni › Importa ed esporta) e il **backup completo** dell'amministratore:
[docs/backup.md](docs/backup.md) spiega cosa contiene ciascuno e come si ripristina.

Poi segui [Getting started](docs/getting-started.md): l'amministratore, un
portafoglio, i conti e le categorie, le prime transazioni.

Lo metti dietro HTTPS (consigliato per tutto ciò che va oltre una rete di casa
fidata)? Vedi [docs/reverse-proxy.md](docs/reverse-proxy.md). Arrivi da HomeBank
desktop? Vedi [docs/migrate-from-homebank.md](docs/migrate-from-homebank.md).

<!-- /quick-start -->

## Il resto, in inglese

La configurazione (le variabili `CB_*`), le immagini del container e il significato dei tag, l'installazione come app e tutte le guide sono nel [README inglese](README.md) e in [docs/](docs/README.md). Attenzione ai tag: `:main` è l'ultima versione stabile, `:latest` la build notturna.

## Licenza

CloudBank è distribuito con la **GNU Affero General Public License v3.0**: vedi [LICENSE](LICENSE). Se fai girare una versione modificata come servizio di rete, l'AGPL ti chiede di offrirne il codice sorgente a chi la usa.

## Sostieni il progetto

CloudBank è un progetto open source fatto con passione. Se ti è utile, valuta una
donazione: aiuta davvero ed è molto apprezzata. ♥ Il modo più semplice è
[**Buy Me a Coffee**](https://buymeacoffee.com/easly1989). Se ne preferisci un altro,
la [pagina delle donazioni](https://easly1989.github.io/donate.html) li elenca tutti:
[PayPal](https://paypal.me/carloruggiero),
[Stripe](https://buy.stripe.com/8x26oAeqA7h6dPk80hfbq00),
[Liberapay](https://liberapay.com/amon2126/donate) o
[GitHub Sponsors](https://github.com/sponsors/easly1989).

---

<sub>Allineato al README della v3.8.0.</sub>
