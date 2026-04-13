# flathunter – Piano di Implementazione

Obiettivo: piattaforma personale per automatizzare la ricerca di appartamenti a Berlino da più portali (ImmoScout24, Immowelt, Kleinanzeigen, WG-Gesucht, portali pubblici, ecc.), con:
- scraping/automazione browser periodica
- normalizzazione e deduplicazione annunci
- scoring secondo regole configurabili
- dashboard web (solo per me)
- reach-out semi/automatico verso gli annunci selezionati

## 1. Stack tecnico

- **Frontend:**  
  - React + Vite oppure Next.js (scelta dev), deploy su Netlify (già in uso).  
- **Backend/API:**  
  - Node.js + TypeScript  
  - Framework leggero: Express o Fastify per API REST.  
- **DB:**  
  - PostgreSQL (se disponibile sul VPS) _oppure_ SQLite per MVP (un singolo utente).  
- **Automazione & scraping:**  
  - Playwright (Node) per browser automation headless.  
- **Integrazioni AI (Fase 2):**  
  - OpenAI API (GPT‑4.x) _o_ Anthropic API per:
    - generare messaggi di candidatura
    - arricchire scoring / classificazione testi annunci
- **Infra:**  
  - VPS OVH (1–2 vCPU, 2–4 GB RAM) per:
    - backend + cron job scraping
    - Playwright headless
  - Netlify per:
    - hosting frontend
    - eventuali funzioni leggere `/.netlify/functions/*` come proxy API se utile.

## 2. Struttura della repository

Organizzare la repo `flathunter` così:

```text
flathunter/
  README.md
  PLAN.md
  netlify.toml            # Config per deploy frontend + eventuali funzioni
  package.json
  pnpm-lock.yaml / yarn.lock / package-lock.json

  /apps
    /frontend             # UI React/Next, buildata su Netlify
    /backend              # API server + job scheduler

  /infra
    docker-compose.yml    # Per sviluppo locale (DB + backend)
    /scripts              # Script di deployment, migrazioni, seed

  /docs
    api.md
    data-model.md
    portals-notes.md
```

Dettaglio `/apps/backend`:

```text
apps/backend/
  src/
    index.ts              # bootstrap server
    config.ts
    logger.ts

    /db
      client.ts           # wrapper per Postgres/SQLite
      migrations/         # schema DB

    /models
      Listing.ts
      PortalSource.ts
      ContactAttempt.ts

    /services
      scoringService.ts
      listingService.ts
      contactService.ts

    /scrapers
      commons/
        browser.ts        # helper Playwright (launch, context, etc.)
        htmlParser.ts
      immoweltScraper.ts
      immoscoutScraper.ts
      kleinanzeigenScraper.ts
      wgGesuchtScraper.ts
      degewoScraper.ts
      ohneMaklerScraper.ts

    /jobs
      runAllScrapers.ts
      runScoring.ts
      runAutoContact.ts

    /routes
      listingsRouter.ts
      statsRouter.ts
      configRouter.ts

  tsconfig.json
```

Dettaglio `/apps/frontend` lasciato al framework scelto (React/Next).

## 3. Modello dati

Definire schema DB minimo (può stare in `docs/data-model.md` + migrazioni):

### Tabella `listings`

Campi indicativi:
- `id` (PK)
- `portal` (enum: `IMMOSCOUNT24`, `IMMOWELT`, `KLEINANZEIGEN`, `WG_GESUCHT`, `DEGEWO`, `OHNE_MAKLER`, ...)
- `portal_listing_id` (string, se esiste ID stabile)
- `url` (unique per portale + id)
- `title`
- `description`
- `city`, `district` (Bezirk), `neighborhood`
- `rent_cold` (numeric)
- `rent_warm` (numeric, opzionale)
- `size_sqm` (numeric)
- `rooms` (numeric)
- `floor` (string o int)
- `available_from` (date, opzionale)
- `is_furnished` (boolean)
- `has_balcony` (boolean)
- `has_elevator` (boolean)
- `source_raw` (JSONB/text con snapshot grezzo dei dati)

- metadata:
  - `inserted_at`, `updated_at`
  - `score` (numeric)
  - `status` (enum: `NEW`, `REVIEWED`, `CONTACTED`, `REJECTED`, `BLACKLISTED`)

### Tabella `contact_attempts`

- `id`
- `listing_id` (FK)
- `timestamp`
- `channel` (enum: `PORTAL_FORM`, `EMAIL`, `PHONE`, `OTHER`)
- `message_subject`
- `message_body`
- `status` (enum: `SENT`, `FAILED`, `MANUAL`)
- `error_message` (text)

### Tabella `portal_sources` (config per ogni portale)

- `id`
- `portal` (enum)
- `search_url_template` o parametri di ricerca
- `enabled` (boolean)
- `scrape_interval_minutes`
- `last_run_at`, `last_success_at`
- altri parametri specifici (JSONB).

## 4. Fase 1 – MVP con intelligenza base (già “furbo”)

### 4.1. Setup backend + DB

Obiettivi:
- avviare server API
- connettersi al DB
- esporre endpoint minimi per listings

Task:

1. In `apps/backend`:
   - inizializzare Node + TypeScript
   - configurare lint/format (ESLint + Prettier)
2. Implementare `db/client.ts`:
   - wrapper per Postgres/SQLite (es. via Prisma o Knex)
3. Creare migrazioni per tabelle `listings`, `contact_attempts`, `portal_sources`.
4. Implementare `listingService.ts` con operazioni base:
   - `upsertListingFromPortal(portal, rawData)`
   - `listListings(filters)`
   - `markListingStatus(id, status)`
5. Implementare API REST:
   - `GET /api/listings` con filtri (prezzo max, distretto, status)
   - `PATCH /api/listings/:id/status`
   - `GET /api/stats/summary` (conteggio per status/portal)

### 4.2. Scraper per primo portale pilota (es. Immowelt)

Obiettivi:
- eseguire una ricerca parametrizzata
- estrarre annunci con Playwright
- salvarli in DB

Task:

1. Implementare `scrapers/commons/browser.ts`:
   - funzione `withBrowser(callback)` che:
     - lancia browser Playwright
     - crea context e page
     - esegue callback
     - chiude risorse
2. Implementare `immoweltScraper.ts`:
   - input: filtri standard (budget max, min m², min rooms, quartieri)
   - passi:
     - navigare alla pagina di ricerca
     - impostare filtri via URL o UI
     - estrarre lista di risultati (URL, titolo, prezzo, m², stanze)
     - per ogni annuncio, aprire pagina dettaglio per info aggiuntive
     - mappare verso modello `Listing`
     - chiamare `listingService.upsertListingFromPortal(...)`
3. Implementare `jobs/runAllScrapers.ts`:
   - legge `portal_sources` abilitati
   - chiama `immoweltScraper` e, quando pronti, anche gli altri
   - log degli errori + update `last_run_at` / `last_success_at`

4. Integrare job scheduler:
   - usare `node-cron` o simile dentro il backend
   - config: eseguire `runAllScrapers` ogni 30–60 minuti (parametrizzabile da config/env)

## 5. Fase 2 – Scoring + UI frontend

### 5.1. Motore di scoring

Obiettivi:
- assegnare punteggio a ogni annuncio in base alle regole
- aggiornare `listings.score` periodicamente

Task:

1. Definire in `config.ts` una struttura di pesi, ad es.:

```ts
export const scoringConfig = {
  maxRentCold: 1600,
  idealSizeRange:,[1]
  bonusBalcony: 5,
  bonusElevator: 3,
  penaltyFurnished: -4,
  weightRentPerSqm: -0.4,
  weightDistanceToWork: -0.5, // placeholder, da calcolare più avanti
};
```

2. Implementare `scoringService.ts`:
   - funzione `scoreListing(listing)` che:
     - calcola punteggio su 0–100
   - funzione `recomputeAllScores()`:
     - ricalcola score per gli annunci NEW/REVIEWED
3. Job `jobs/runScoring.ts`:
   - schedulato post-scraping o 1–2 volte al giorno

### 5.2. Frontend

Obiettivi:
- tabella annunci filtrabile
- vista dettaglio con link al portale
- controlli base di stato (mark contacted / rejected)

Task:

1. Pagina principale:
   - tabella con colonne: portal, district, price, size, rooms, score, status
   - filtri: max prezzo, min m², min score, portal, status
2. Pagina dettaglio annuncio:
   - tutte le info strutturate
   - spezzone di descrizione
   - link `Apri annuncio originale`
   - pulsanti:
     - “Segna come contattato”
     - “Segna come scartato”

3. Configurazione:
   - pagina o sezione “Settings” con parametri scoring (modificabili in UI, salvati via API).

## 6. Fase 3 – Automazione reach-out (con e senza LLM)

### 6.1. Senza LLM (subito)

Obiettivi:
- inviare messaggi di candidatura usando template statici parametrizzati

Task:

1. Definire template in `contactService.ts`:

```ts
const template = `
Sehr geehrte Damen und Herren,

ich interessiere mich für die Wohnung in {{district}} ({{size_sqm}}m², {{rent_cold}}€ kalt) auf {{portal}}.

Kurz zu mir: {{short_bio}}.

Mit freundlichen Grüßen
{{name}}
`;
```

2. Implementare `contactService.buildMessage(listing, profile)`:
   - sostituisce placeholder con i dati config e dell’annuncio
3. Implementare `contactService.sendForListing(listingId)`:
   - per ora, mock: loggare su console / salvare in DB come `status = MANUAL`
   - in una fase successiva:
     - integrazione email (SMTP / provider API)
     - integrazione con form dei portali via Playwright (compilazione automatica)

4. Job `jobs/runAutoContact.ts`:
   - prende i migliori N annunci NON contattati con score > soglia
   - genera messaggi
   - li marca come `status = CONTACTED` o `MANUAL` a seconda dell’implementazione

### 6.2. Con LLM (dopo aver attivato API)

Obiettivi:
- migliorare qualità/personalizzazione dei messaggi

Task:

1. Aggiungere `llmService.ts`:
   - funzione `generateContactMessage(listing, profile, templateGuidelines)` che:
     - chiama API LLM
     - ritorna testo pronto all’uso
2. Integrare in `contactService` un flag:
   - `USE_LLM_FOR_MESSAGES = true/false`
3. Aggiornare `runAutoContact` per usare LLM se attivo.

## 7. Fase 4 – Estendere ad altri portali

Per ogni nuovo portale (`immoscoutScraper`, `kleinanzeigenScraper`, `wgGesuchtScraper`, `degewoScraper`, `ohneMaklerScraper`, ecc.):

1. Documentare in `docs/portals-notes.md`:
   - URL di ricerca base
   - parametri di filtro disponibili
   - eventuali limitazioni anti‑bot / ToS
2. Implementare scraper dedicato:
   - usare sempre `scrapers/commons/browser.ts` per riusare setup Playwright
   - normalizzare i dati al modello `Listing`
3. Aggiornare `portal_sources` con config per il nuovo portale.

## 8. Dev & deploy

### 8.1. Sviluppo locale

- Aggiungere script `pnpm dev` / `npm run dev` che:
  - avviano backend su `localhost:4000`
  - avviano frontend su `localhost:3000`
- Opzionale: usare `docker-compose` per DB + backend.

### 8.2. Deploy

- **Frontend su Netlify:**
  - configurare `netlify.toml` con:
    - `publish` directory (build frontend)
    - eventuale `functions = "netlify/functions"` per API leggere
- **Backend + scraper su VPS:**
  - deploy via git pull + `pm2`/`systemd`
  - configurare cron job:
    - `*/30 * * * * node /path/to/apps/backend/dist/jobs/runAllScrapers.js`
    - `0 * * * * node /path/to/apps/backend/dist/jobs/runScoring.js`
    - `5 * * * * node /path/to/apps/backend/dist/jobs/runAutoContact.js`

### 8.3. Logging e osservabilità

- Introdurre logger strutturato (es. pino) con:
  - log per ogni scraper run (tempo, #annunci, errori)
  - log per ogni contact attempt
- In futuro, integrare alert (es. email) se:
  - uno scraper fallisce N volte di fila
  - non arrivano nuovi annunci per X ore

## 9. Priorità iniziali per Codex

1. Impostare monorepo, struttura cartelle e config base (TypeScript, lint, ecc.).  
2. Implementare backend + DB + schema + API /api/listings base.  
3. Implementare scraper Immowelt + job scheduler.  
4. Implementare motore di scoring + runScoring.  
5. Implementare UI minimale per visualizzare e filtrare annunci.  
6. Implementare template statici di candidatura + runAutoContact in modalità “manuale” (solo generazione, niente invio reale).

Da qui, iterare aggiungendo:
- nuovi portali
- invio email reale
- integrazione LLM per messaggi
- automazione form sui portali con Playwright.