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
  const verbruiktStored = num(p.verbruikte_uren);
  return {
    id: obj.id,
    naam: p.naam || 'Strippenkaart',
    totaal,
    verbruikt: verbruiktStored,
    resterend: totaal - verbruiktStored,
    uurtarief: num(p.uurtarief),
    startdatum: p.startdatum ? Number(new Date(p.startdatum)) : null,
    geldigTot: p.geldig_tot ? Number(new Date(p.geldig_tot)) : null,
    status: p.status || 'actief',
    _storedVerbruikt: verbruiktStored,
    _storedStatus: p.status || 'actief',
  };
}

async function getData(companyId) {
  const { strip, uren } = await getTypeIds();

  const stripIds = await getAssociatedIds('companies', companyId, strip);
  const kaarten = stripIds.length
    ? (await batchRead(strip, stripIds, STRIP_PROPS)).map(mapKaart)
    : [];
  kaarten.sort((a, b) => (a.startdatum || 0) - (b.startdatum || 0));

  // Verbruikt live berekenen uit de aan de kaart gekoppelde registraties, zodat de
  // balk altijd klopt - ongeacht hoe uren zijn gelogd (card, GRIP of handmatig).
  const regsPerKaart = {};
  for (const k of kaarten) {
    const rIds = await getAssociatedIds(strip, k.id, uren);
    const regs = rIds.length ? await batchRead(uren, rIds, UREN_PROPS) : [];
    const mapped = regs.map((r) => ({
      id: r.id,
      omschrijving: (r.properties || {}).omschrijving || '',
      datum: (r.properties || {}).datum
        ? Number(new Date(r.properties.datum))
        : null,
      uren: num((r.properties || {}).uren),
      werktype: (r.properties || {}).werktype || '',
      medewerker: (r.properties || {}).medewerker || '',
    }));
    regsPerKaart[k.id] = mapped;
    const live = mapped.reduce((s, x) => s + x.uren, 0);
    k.verbruikt = live;
    k.resterend = k.totaal - live;
    k.status = berekenStatus(k.totaal, live, k.geldigTot);
    // Zelfherstel: opgeslagen teller bijwerken als die is afgeweken (houdt de
    // grip-tool en eventuele workflows kloppend, ongeacht het logkanaal).
    if (Math.abs(live - k._storedVerbruikt) > 0.001 || k.status !== k._storedStatus) {
      try {
        await api(`/crm/v3/objects/${strip}/${k.id}`, 'PATCH', {
          properties: {
            verbruikte_uren: live,
            resterende_uren: k.totaal - live,
            status: k.status,
          },
        });
      } catch (e) {
        // teller-sync mag de weergave nooit blokkeren
      }
    }
  }

  const actieve =
    kaarten.find((k) => k.status !== 'verbruikt' && k.status !== 'verlopen') || null;
  const bronKaart = actieve || kaarten[kaarten.length - 1] || null;
  const recent = bronKaart
    ? (regsPerKaart[bronKaart.id] || [])
        .slice()
        .sort((a, b) => (b.datum || 0) - (a.datum || 0))
        .slice(0, 50)
    : [];

  return { kaarten, actieve, recent };
}

exports.main = async (context = {}) => {
  try {
    const { companyId } = context.parameters || {};
    if (!companyId) return { error: 'companyId ontbreekt' };
    return await getData(String(companyId));
  } catch (e) {
    return { error: e.message };
  }
};
