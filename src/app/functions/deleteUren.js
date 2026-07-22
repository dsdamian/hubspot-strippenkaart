const BASE = process.env.HUBSPOT_API_BASE || 'https://api.hubapi.com';
const TOKEN = process.env.PRIVATE_APP_ACCESS_TOKEN;

const STRIP_PROPS = [
  'naam',
  'totaal_uren',
  'verbruikte_uren',
  'resterende_uren',
  'uurtarief',
  'startdatum',
  'geldig_tot',
  'status',
];
const UREN_PROPS = ['omschrijving', 'datum', 'uren', 'werktype', 'medewerker'];

async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API ${method} ${path} gaf ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

let typeIdCache = null;

async function getTypeIds() {
  if (typeIdCache) return typeIdCache;
  const data = await api('/crm-object-schemas/v3/schemas');
  const byName = {};
  for (const s of data.results || []) byName[s.name] = s.objectTypeId;
  if (!byName.strippenkaart || !byName.urenregistratie) {
    throw new Error(
      'Custom objects "strippenkaart" en/of "urenregistratie" niet gevonden. Maak ze eerst aan (zie README, sectie Installatie).'
    );
  }
  typeIdCache = { strip: byName.strippenkaart, uren: byName.urenregistratie };
  return typeIdCache;
}

async function getAssociatedIds(fromType, fromId, toType) {
  const data = await api(
    `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}?limit=500`
  );
  return (data.results || []).map((r) => String(r.toObjectId));
}

async function batchRead(objectType, ids, properties) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await api(`/crm/v3/objects/${objectType}/batch/read`, 'POST', {
      inputs: chunk.map((id) => ({ id })),
      properties,
    });
    out.push(...(data.results || []));
  }
  return out;
}

async function associateDefault(fromType, fromId, toType, toId) {
  await api(
    `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
    'PUT'
  );
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function berekenStatus(totaal, verbruikt, geldigTot) {
  const rest = totaal - verbruikt;
  if (geldigTot && Number(geldigTot) < Date.now() && rest > 0) return 'verlopen';
  if (rest <= 0) return 'verbruikt';
  if (totaal > 0 && rest / totaal <= 0.2) return 'bijna_op';
  return 'actief';
}

function mapKaart(obj) {
  const p = obj.properties || {};
  const totaal = num(p.totaal_uren);
  const verbruikt = num(p.verbruikte_uren);
  return {
    id: obj.id,
    naam: p.naam || 'Strippenkaart',
    totaal,
    verbruikt,
    resterend: totaal - verbruikt,
    uurtarief: num(p.uurtarief),
    startdatum: p.startdatum ? Number(new Date(p.startdatum)) : null,
    geldigTot: p.geldig_tot ? Number(new Date(p.geldig_tot)) : null,
    status: p.status || 'actief',
  };
}

async function getData(companyId) {
  const { strip, uren } = await getTypeIds();

  const stripIds = await getAssociatedIds('companies', companyId, strip);
  const kaarten = stripIds.length
    ? (await batchRead(strip, stripIds, STRIP_PROPS)).map(mapKaart)
    : [];
  kaarten.sort((a, b) => (a.startdatum || 0) - (b.startdatum || 0));

  const actieve =
    kaarten.find((k) => k.status !== 'verbruikt' && k.status !== 'verlopen') || null;

  const urenIds = await getAssociatedIds('companies', companyId, uren);
  let recent = [];
  if (urenIds.length) {
    const regs = await batchRead(uren, urenIds.slice(-200), UREN_PROPS);
    recent = regs
      .map((r) => ({
        id: r.id,
        omschrijving: (r.properties || {}).omschrijving || '',
        datum: (r.properties || {}).datum
          ? Number(new Date(r.properties.datum))
          : null,
        uren: num((r.properties || {}).uren),
        werktype: (r.properties || {}).werktype || '',
        medewerker: (r.properties || {}).medewerker || '',
      }))
      .sort((a, b) => (b.datum || 0) - (a.datum || 0))
      .slice(0, 50);
  }

  return { kaarten, actieve, recent };
}

function datumNaarMs(datum) {
  if (datum && typeof datum === 'object' && datum.year != null) {
    return Date.UTC(datum.year, datum.month, datum.date);
  }
  const nu = new Date();
  return Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate());
}

exports.main = async (context = {}) => {
  try {
    const { companyId, regId } = context.parameters || {};
    if (!companyId || !regId) return { error: 'companyId of regId ontbreekt' };

    const types = await getTypeIds();
    const oud = await api(`/crm/v3/objects/${types.uren}/${regId}?properties=uren`);
    const oudeUren = num((oud.properties || {}).uren);
    const kaartIds = await getAssociatedIds(types.uren, regId, types.strip);

    await api(`/crm/v3/objects/${types.uren}/${regId}`, 'DELETE');

    if (kaartIds.length) {
      const kaart = (await batchRead(types.strip, [kaartIds[0]], STRIP_PROPS)).map(mapKaart)[0];
      const nieuwVerbruikt = Math.max(0, kaart.verbruikt - oudeUren);
      await api(`/crm/v3/objects/${types.strip}/${kaart.id}`, 'PATCH', {
        properties: {
          verbruikte_uren: nieuwVerbruikt,
          resterende_uren: kaart.totaal - nieuwVerbruikt,
          status: berekenStatus(kaart.totaal, nieuwVerbruikt, kaart.geldigTot),
        },
      });
    }

    return await getData(String(companyId));
  } catch (e) {
    return { error: e.message };
  }
};
