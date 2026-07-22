#!/usr/bin/env python3
"""
Maakt de custom objects 'Strippenkaart' en 'Urenregistratie' aan in HubSpot.

Gebruik:
    export HUBSPOT_TOKEN="pat-eu1-..."   # access token van de private app
    python3 create_custom_objects.py

Optioneel (alleen bij EU data residency portalen):
    export HUBSPOT_API_BASE="https://api-eu1.hubapi.com"

Het script is idempotent: bestaat een object al, dan wordt het overgeslagen.
"""
import json
import os
import sys
import urllib.request
import urllib.error

BASE = os.environ.get("HUBSPOT_API_BASE", "https://api.hubapi.com")
TOKEN = os.environ.get("HUBSPOT_TOKEN")

if not TOKEN:
    sys.exit("Zet eerst HUBSPOT_TOKEN (access token van de private app, met scope crm.schemas.custom.write).")


def api(path, method="GET", body=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res), res.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}"), e.code


def bestaande_schemas():
    data, status = api("/crm-object-schemas/v3/schemas")
    if status != 200:
        sys.exit(f"Kon schemas niet ophalen ({status}): {data}")
    return {s["name"]: s for s in data.get("results", [])}


STRIPPENKAART = {
    "name": "strippenkaart",
    "labels": {"singular": "Strippenkaart", "plural": "Strippenkaarten"},
    "primaryDisplayProperty": "naam",
    "requiredProperties": ["naam", "totaal_uren"],
    "searchableProperties": ["naam"],
    "properties": [
        {"name": "naam", "label": "Naam", "type": "string", "fieldType": "text"},
        {"name": "totaal_uren", "label": "Totaal uren", "type": "number", "fieldType": "number"},
        {"name": "verbruikte_uren", "label": "Verbruikte uren", "type": "number", "fieldType": "number"},
        {"name": "resterende_uren", "label": "Resterende uren", "type": "number", "fieldType": "number"},
        {"name": "uurtarief", "label": "Uurtarief (EUR)", "type": "number", "fieldType": "number"},
        {"name": "startdatum", "label": "Startdatum", "type": "date", "fieldType": "date"},
        {"name": "geldig_tot", "label": "Geldig tot", "type": "date", "fieldType": "date"},
        {
            "name": "status",
            "label": "Status",
            "type": "enumeration",
            "fieldType": "select",
            "options": [
                {"label": "Actief", "value": "actief"},
                {"label": "Bijna op", "value": "bijna_op"},
                {"label": "Verbruikt", "value": "verbruikt"},
                {"label": "Verlopen", "value": "verlopen"},
            ],
        },
    ],
    "associatedObjects": ["COMPANY", "DEAL"],
}

URENREGISTRATIE = {
    "name": "urenregistratie",
    "labels": {"singular": "Urenregistratie", "plural": "Urenregistraties"},
    "primaryDisplayProperty": "omschrijving",
    "requiredProperties": ["uren"],
    "searchableProperties": ["omschrijving"],
    "properties": [
        {"name": "omschrijving", "label": "Omschrijving", "type": "string", "fieldType": "text"},
        {"name": "datum", "label": "Datum", "type": "date", "fieldType": "date"},
        {"name": "uren", "label": "Uren", "type": "number", "fieldType": "number"},
        {
            "name": "werktype",
            "label": "Werktype",
            "type": "enumeration",
            "fieldType": "select",
            "options": [
                {"label": "Workflows & automatisering", "value": "workflows"},
                {"label": "Rapportages & dashboards", "value": "rapportages"},
                {"label": "Campagnes", "value": "campagnes"},
                {"label": "Support & vragen", "value": "support"},
                {"label": "Overleg", "value": "overleg"},
                {"label": "Overig", "value": "overig"},
            ],
        },
        {"name": "medewerker", "label": "Medewerker", "type": "string", "fieldType": "text"},
    ],
    "associatedObjects": ["COMPANY"],  # strippenkaart wordt hieronder toegevoegd
}


def maak_schema(schema):
    naam = schema["name"]
    bestaand = bestaande_schemas()
    if naam in bestaand:
        print(f"- '{naam}' bestaat al ({bestaand[naam]['objectTypeId']}), overslaan.")
        return bestaand[naam]
    data, status = api("/crm-object-schemas/v3/schemas", "POST", schema)
    if status not in (200, 201):
        sys.exit(f"Aanmaken van '{naam}' mislukt ({status}): {data}")
    print(f"+ '{naam}' aangemaakt: {data['objectTypeId']} ({data['fullyQualifiedName']})")
    return data


if __name__ == "__main__":
    strip = maak_schema(STRIPPENKAART)
    URENREGISTRATIE["associatedObjects"].append(strip["fullyQualifiedName"])
    uren = maak_schema(URENREGISTRATIE)
    print()
    print("Klaar. Object type IDs:")
    print(f"  strippenkaart:   {strip['objectTypeId']}")
    print(f"  urenregistratie: {uren['objectTypeId']}")
    print("De app functions zoeken deze zelf op via de schemas API, je hoeft ze nergens in te vullen.")
