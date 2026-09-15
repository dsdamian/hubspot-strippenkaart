# Strippenkaart App | status & openstaande acties

Bijgewerkt: 9 september 2026

> Dit bestand is de vaste plek voor de stand van zaken. Damian streept af en vult aan bij elke sessie.
> Losse taken uit mail en HubSpot staan in Grip; dit bestand gaat over wat er gebouwd is, welke
> besluiten er liggen en hoe lang een blokkade openstaat.
>
> **Let op: onderstaande context komt uit het geheugen en is nog niet geverifieerd tegen het portaal.**
> Bij de eerstvolgende sessie voor deze klant vullen we de secties hieronder met de echte stand.

## Context

Strippenkaart-app: urenregistratie op strippenkaarten per klant, als HubSpot app card op bedrijfsrecords in het eigen MMM-portaal (Enterprise). Projectmap: `~/Desktop/MMM/Strippenkaart App`.

- HubSpot developer project, platformversie 2026.03 (private app, static auth, app functions)
- Custom objects: `strippenkaart` en `urenregistratie` (aanmaken via `setup/create_custom_objects.py` met PAT)
- Card roept functions aan via `hubspot.serverless('<uid>', {parameters})`; functions vinden objectTypeIds zelf via de schemas API
- MMM eigen portaal: 9435548 (CLI-account "make-marketing-magic", personal access key auth)
- Functies: kaart aanmaken (ook retroactief met startdatum), kaart bewerken (naam/startdatum/totaal/tarief), uren loggen/bewerken/verwijderen op regelniveau met automatische saldocorrectie (verwijderen in bewerkformulier met bevestiging), tabel toont 5 recente met toon-alles link (max 50), Delen-knop: PDF-maandrapport (liggend A4, MMM-logo als vector, uren rechts uitgelijnd) + CSV-export per maand of hele looptijd, upload naar HubSpot Files map /strippenkaart-rapporten (publieke link)
- Status per 15 jul 2026: v1 AF en door gebruiker goedgekeurd. Testdata staat op Global Anti-Scam Alliance (record 56428065658). Nog open: workflows (bijna-op-melding, verlengingsdeal), evt. testdata opruimen, uitrol naar echte klanten
- Maandflow rapportage: bedrijfsrecord > Delen > maand kiezen > PDF/CSV > link mailen naar klant Custom objects: strippenkaart = 2-65886742, urenregistratie = 2-65886790. Card staat op tab "Klantprofiel & Afspraken" (sectie "SLA & Strippenkaart") van de company-standaardweergave. Testdata op Global Anti-Scam Alliance (record 56428065658): kaart 50 uur met 16,5 verbruikt waarvan 15 uur een foutieve testregistratie - opruimen of behouden nog met gebruiker af te stemmen. Nog te doen: workflows (bijna-op-alert, verlengingsdeal, maandrapportage)
- Geleerd: `PRIVATE_APP_ACCESS_TOKEN` is een gereserveerde secret-naam, HubSpot injecteert hem automatisch in app functions; custom objects kunnen tokenloos via `hs custom-object create-schema`; associatedObjects verwijst naar ander custom object via objectTypeId (2-xxx), niet fqn; app na deploy ook INSTALLEREN (Distribution > Install now) anders geen card in de bibliotheek; app functions bundelen geen sibling-modules (helpers inline); NumberInput vereist precision={2} voor decimalen
- Let op: oude CRM cards vervallen per 31 okt 2026, alles moet via UI extensions

## ✅ Klaar

- _nog te vullen_

## 🔧 Damian - nog te doen

- [ ] _nog te vullen_

## 👤 Klant

- [ ] _nog te vullen_

## 🔌 Collega's

- [ ] _nog te vullen_

## Besluiten

- _nog te vullen_

## Logboek

- **9 september 2026** STATUS.md aangemaakt, context uit geheugen overgenomen.
