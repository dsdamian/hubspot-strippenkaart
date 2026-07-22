# HubSpot Strippenkaart-app

Urenregistratie op strippenkaarten, als app card op het bedrijfsrecord in HubSpot.
Een klant koopt een bundel uren (bijv. 50), jij logt je uren op de card en de app boekt
automatisch af, berekent het resterende saldo en zet de status op "bijna op" bij minder dan 20%.
Eén klik levert een PDF-maandrapport of CSV-export voor de klant.

Gebouwd door [Make Marketing Magic](https://makemarketingmagic.com). Vrij te gebruiken en aan te
passen onder de MIT-licentie - ook voor collega HubSpot-partners.

> Volledig native in HubSpot: custom objects, een React-card (UI extension) en serverless app
> functions. Geen externe hosting, geen abonnement.

## Vereisten

- **HubSpot Enterprise** (custom objects en app functions zitten achter een Enterprise-hub)
- **Node.js** (LTS) en de **HubSpot CLI** (`npm install -g @hubspot/cli`)
- Platformversie **2026.03**

## Wat zit erin

- `src/app/cards/StrippenkaartCard.jsx` - de React app card: voortgangsbalk, uren loggen,
  registraties bewerken/verwijderen, kaart aanmaken/bewerken (incl. retroactieve startdatum),
  en een deelpaneel voor rapporten.
- `src/app/functions/` - serverless functions die in HubSpot draaien:
  - `get_strippenkaart_data` - haalt kaarten + registraties van het bedrijf op
  - `log_uren` - maakt een urenregistratie aan, koppelt hem en boekt af (FIFO op oudste actieve kaart)
  - `create_strippenkaart` - maakt een nieuwe strippenkaart aan
  - `update_strippenkaart` - wijzigt naam, startdatum, totaal uren en uurtarief
  - `update_uren` / `delete_uren` - bewerken en verwijderen op regelniveau, met saldocorrectie
  - `deel_rapport` - genereert een PDF-maandrapport of CSV en zet die in HubSpot-bestanden
- `setup/*.json` - de definities van de custom objects Strippenkaart en Urenregistratie
- `setup/create_custom_objects.py` - alternatief Python-script om de objecten met een token aan te maken

## Installatie

1. **Authenticeren met je portaal**:
   ```bash
   hs init            # volg de browserflow, kies je portaal
   ```
2. **Custom objects aanmaken** (via de CLI, geen token nodig):
   ```bash
   hs custom-object create-schema --path setup/strippenkaart-schema.json
   ```
   Noteer het `objectTypeId` dat je terugkrijgt (bijv. `2-1234567`). Zet dat in
   `setup/urenregistratie-schema.json` bij `associatedObjects` op de plek van
   `REPLACE_WITH_STRIPPENKAART_OBJECT_TYPE_ID`, en draai dan:
   ```bash
   hs custom-object create-schema --path setup/urenregistratie-schema.json
   ```
   De app functions zoeken de objecten daarna zelf op via de schemas-API, dus je hoeft nergens
   ID's te hardcoden. HubSpot injecteert `PRIVATE_APP_ACCESS_TOKEN` automatisch in de functions
   (het is een gereserveerde secret-naam).
3. **Project uploaden en deployen**:
   ```bash
   hs project upload
   ```
4. **App installeren** (cruciaal, anders verschijnt de card nergens): projectpagina >
   klik op de app > tabblad **Distribution** > **Install now** > vinkje + Connect App.
   Deployen alleen is niet genoeg; zonder installatie blijft de card onzichtbaar in de bibliotheek.
5. **Card op het bedrijfsrecord zetten**: open een bedrijf > **Aanpassen** > kies een tab >
   voeg via de kaartbibliotheek (filter op **App**) de kaart toe en sla het weergaveprofiel op.

## Maak het van jezelf (branding)

Deze repo bevat geen bedrijfsbranding; standaard zijn de rapporten neutraal. Zo zet je je
eigen naam en logo erin:

1. **Naam op de card** ("Powered by ..."): pas `config.name` aan in `src/app/app-hsmeta.json`.
2. **Logo op het PDF-rapport**: open `src/app/functions/deelRapport.js` en vul in het
   BRANDING-blok bovenaan `LOGO_PNG_BASE64` met je logo als base64-PNG:
   ```bash
   # macOS:   zet het resultaat op je klembord
   base64 -i logo.png | pbcopy
   # Linux:
   base64 -w0 logo.png
   ```
   (Geen terminal? Zoek online op "png to base64".) Werkt met elk logo, ook meerdere kleuren
   en transparantie. Een breed logo van ongeveer 3:1 oogt het mooist. Laat leeg voor geen logo.
3. **Naam onder het rapport**: zet je bedrijfsnaam in `BEDRIJFSNAAM` in datzelfde blok
   ("Gegenereerd op &lt;datum&gt; door &lt;naam&gt;"). Laat leeg om alleen de datum te tonen.

Deploy daarna opnieuw met `hs project upload`.

## Dagelijks gebruik

- Open het bedrijf van de klant, vul datum/uren/werktype/omschrijving in en klik **Loggen**.
- Geen actieve kaart? De card toont een formulier om er direct een aan te maken (ook met een
  startdatum in het verleden voor retroactief invoeren).
- Uren boeken af van de oudste actieve kaart (FIFO). Registraties zijn per regel te bewerken en
  te verwijderen; het saldo corrigeert automatisch.
- Rapport delen: knop **Delen** > kies een maand of de hele looptijd > **PDF-rapport** of
  **CSV-export**. Het bestand komt in HubSpot-bestanden met een deelbare link.

## Aanbevolen workflows (klikwerk, geen code)

Maak workflows op basis van het object Strippenkaart:

1. **Bijna op**: trigger `status = bijna_op` > interne notificatie + taak "verlenging bespreken".
2. **Verbruikt**: trigger `status = verbruikt` > deal aanmaken in een pijplijn "Strippenkaart verlenging".
3. **Maandrapportage**: een terugkerende taak als reminder om de rapporten te versturen.

## Ontwikkelen

```bash
hs project dev      # lokale dev-server met hot reload op de card
hs project upload   # nieuwe build uploaden en deployen
hs project logs     # logs van de app functions
```

## Bekende beperkingen / leerpunten

- Uren die het restant van een kaart overschrijden worden niet gesplitst over twee kaarten;
  de kaart gaat door nul heen en krijgt status "verbruikt".
- App functions bundelen alleen het entrypoint-bestand; gedeelde code moet **inline** in elk
  function-bestand staan (een `require` van een lokaal bestand faalt met "Cannot find module").
- `NumberInput` heeft `precision={2}` nodig, anders worden decimalen weggegooid.
- Mogelijke uitbreidingen: timer-knop, uren loggen vanaf deals/tickets, automatische
  facturatie-export, prognose "op deze snelheid is de kaart op over X weken".

## Licentie

MIT - zie [LICENSE](LICENSE).
