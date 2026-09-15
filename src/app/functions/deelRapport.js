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

function datumNaarMs(datum) {
  if (datum && typeof datum === 'object' && datum.year != null) {
    return Date.UTC(datum.year, datum.month, datum.date);
  }
  const nu = new Date();
  return Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate());
}

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ── BRANDING (pas dit aan naar je eigen bedrijf) ──────────────────────────
// Logo rechtsboven op het rapport. Makkelijkste manier: plak je logo als
// base64-PNG (werkt met elk logo, ook meerdere kleuren en transparantie):
//   macOS:  base64 -i logo.png | pbcopy      (staat daarna op je klembord)
//   Linux:  base64 -w0 logo.png
//   of zoek online op "png to base64".
// Laat leeg ('') voor geen logo.
const LOGO_PNG_BASE64 = '';

// Geavanceerd alternatief: een enkelpad-SVG. Vul het 'd'-attribuut en de
// viewBox van je SVG in. Wordt alleen gebruikt als LOGO_PNG_BASE64 leeg is.
const LOGO_SVG_PATH = '';
const LOGO_VIEWBOX = { w: 314, h: 101 };

// Je bedrijfsnaam onderaan het rapport ("Gegenereerd op <datum> door <naam>").
// Laat leeg ('') om alleen de datum te tonen.
const BEDRIJFSNAAM = '';
// ──────────────────────────────────────────────────────────────────────────

const WERKTYPE_LABELS = {
  workflows: 'Workflows & automatisering',
  rapportages: 'Rapportages & dashboards',
  campagnes: 'Campagnes',
  support: 'Support & vragen',
  overleg: 'Overleg',
  overig: 'Overig',
};

const fmtUren = (n) =>
  Number(n || 0).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');

const fmtDatum = (ms) => {
  if (!ms) return '-';
  const d = new Date(Number(ms));
  return `${d.getUTCDate()}-${d.getUTCMonth() + 1}-${d.getUTCFullYear()}`;
};

async function getRegistratiesVoorKaart(types, kaartId) {
  const ids = await getAssociatedIds(types.strip, kaartId, types.uren);
  if (!ids.length) return [];
  const regs = await batchRead(types.uren, ids, UREN_PROPS);
  return regs
    .map((r) => {
      const p = r.properties || {};
      return {
        id: r.id,
        omschrijving: p.omschrijving || '',
        datum: p.datum ? Number(new Date(p.datum)) : null,
        uren: num(p.uren),
        werktype: p.werktype || '',
        medewerker: p.medewerker || '',
      };
    })
    .sort((a, b) => (a.datum || 0) - (b.datum || 0));
}

function csvVeld(v) {
  const s = String(v == null ? '' : v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function maakCsv(bedrijf, kaart, periodeLabel, rows, beginsaldo, afgeboekt) {
  const r = [];
  r.push(['Urenrapportage', bedrijf].map(csvVeld).join(';'));
  r.push(['Strippenkaart', kaart.naam].map(csvVeld).join(';'));
  r.push(['Periode', periodeLabel].map(csvVeld).join(';'));
  r.push(['Beginsaldo (uur)', fmtUren(beginsaldo)].map(csvVeld).join(';'));
  r.push(['Afgeboekt in periode (uur)', fmtUren(afgeboekt)].map(csvVeld).join(';'));
  r.push(['Eindsaldo (uur)', fmtUren(beginsaldo - afgeboekt)].map(csvVeld).join(';'));
  r.push('');
  r.push(['Datum', 'Omschrijving', 'Werktype', 'Medewerker', 'Uren'].join(';'));
  for (const x of rows) {
    r.push(
      [
        fmtDatum(x.datum),
        x.omschrijving,
        WERKTYPE_LABELS[x.werktype] || x.werktype,
        x.medewerker,
        fmtUren(x.uren),
      ]
        .map(csvVeld)
        .join(';')
    );
  }
  r.push(['', '', '', 'Totaal', fmtUren(afgeboekt)].join(';'));
  return '﻿' + r.join('\r\n');
}

function truncate(s, max) {
  return s && s.length > max ? s.slice(0, max - 1) + '…' : s || '';
}

async function maakPdf(bedrijf, kaart, periodeLabel, rows, beginsaldo, afgeboekt) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const groen = rgb(0.16, 0.55, 0.28);
  const grijs = rgb(0.45, 0.45, 0.45);
  const zwart = rgb(0.1, 0.1, 0.1);
  const A4L = [841.89, 595.28];
  const [W, H] = A4L;
  const marge = 50;
  const rechts = W - marge;

  let page = doc.addPage(A4L);
  let y = H - marge;

  const nieuwePagina = () => {
    page = doc.addPage(A4L);
    y = H - marge;
  };

  const drawRight = (tekst, rightX, ty, size, f, color) => {
    const w = f.widthOfTextAtSize(tekst, size);
    page.drawText(tekst, { x: rightX - w, y: ty, size, font: f, color });
  };

  const logoW = 130;
  if (LOGO_PNG_BASE64) {
    // PNG-logo (elk logo, meerdere kleuren): geplaatst rechtsboven, breedte logoW
    try {
      const png = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
      const schaal = logoW / png.width;
      const logoH = png.height * schaal;
      page.drawImage(png, {
        x: rechts - logoW,
        y: H - marge - logoH + 40,
        width: logoW,
        height: logoH,
      });
    } catch (e) {
      // ongeldige base64: sla het logo over in plaats van de hele PDF te laten falen
    }
  } else if (LOGO_SVG_PATH) {
    // Fallback: enkelpad-SVG (zie LOGO_SVG_PATH in het BRANDING-blok)
    const schaal = logoW / LOGO_VIEWBOX.w;
    page.drawSvgPath(LOGO_SVG_PATH, {
      x: rechts - logoW,
      y: H - marge + 12,
      scale: schaal,
      color: zwart,
    });
  }

  page.drawText('Urenrapportage', { x: marge, y, size: 22, font: bold, color: zwart });
  y -= 18;
  page.drawText(bedrijf, { x: marge, y, size: 13, font, color: grijs });
  y -= 30;

  page.drawText(`Strippenkaart: ${kaart.naam}`, { x: marge, y, size: 11, font: bold, color: zwart });
  y -= 16;
  page.drawText(`Periode: ${periodeLabel}   |   Gestart: ${fmtDatum(kaart.startdatum)}`, {
    x: marge, y, size: 10, font, color: grijs,
  });
  y -= 28;

  const eind = beginsaldo - afgeboekt;
  const blok = [
    ['Beginsaldo', `${fmtUren(beginsaldo)} uur`],
    ['Afgeboekt', `${fmtUren(afgeboekt)} uur`],
    ['Eindsaldo', `${fmtUren(eind)} uur`],
  ];
  let bx = marge;
  for (const [label, waarde] of blok) {
    page.drawText(label, { x: bx, y, size: 9, font, color: grijs });
    page.drawText(waarde, { x: bx, y: y - 16, size: 14, font: bold, color: zwart });
    bx += 180;
  }
  y -= 40;

  const breedte = W - 2 * marge;
  const frac = kaart.totaal > 0 ? Math.max(0, Math.min(1, eind / kaart.totaal)) : 0;
  page.drawRectangle({ x: marge, y: y - 4, width: breedte, height: 8, color: rgb(0.9, 0.9, 0.9) });
  if (frac > 0) {
    page.drawRectangle({ x: marge, y: y - 4, width: breedte * frac, height: 8, color: groen });
  }
  y -= 14;
  page.drawText(`${fmtUren(eind)} van ${fmtUren(kaart.totaal)} uur resterend`, {
    x: marge, y: y - 6, size: 9, font, color: grijs,
  });
  y -= 34;

  const kol = {
    datum: marge,
    omschrijving: marge + 75,
    werktype: marge + 430,
    medewerker: marge + 600,
    urenRechts: rechts,
  };
  const kop = () => {
    page.drawText('Datum', { x: kol.datum, y, size: 9, font: bold, color: zwart });
    page.drawText('Omschrijving', { x: kol.omschrijving, y, size: 9, font: bold, color: zwart });
    page.drawText('Werktype', { x: kol.werktype, y, size: 9, font: bold, color: zwart });
    page.drawText('Medewerker', { x: kol.medewerker, y, size: 9, font: bold, color: zwart });
    drawRight('Uren', kol.urenRechts, y, 9, bold, zwart);
    y -= 6;
    page.drawLine({
      start: { x: marge, y }, end: { x: rechts, y },
      thickness: 0.7, color: rgb(0.8, 0.8, 0.8),
    });
    y -= 14;
  };
  kop();

  if (!rows.length) {
    page.drawText('Geen registraties in deze periode.', { x: marge, y, size: 10, font, color: grijs });
    y -= 16;
  }

  for (const r of rows) {
    if (y < marge + 40) {
      nieuwePagina();
      kop();
    }
    page.drawText(fmtDatum(r.datum), { x: kol.datum, y, size: 9, font, color: zwart });
    page.drawText(truncate(r.omschrijving, 78), { x: kol.omschrijving, y, size: 9, font, color: zwart });
    page.drawText(truncate(WERKTYPE_LABELS[r.werktype] || r.werktype, 36), {
      x: kol.werktype, y, size: 9, font, color: zwart,
    });
    page.drawText(truncate(r.medewerker, 24), { x: kol.medewerker, y, size: 9, font, color: zwart });
    drawRight(fmtUren(r.uren), kol.urenRechts, y, 9, font, zwart);
    y -= 15;
  }

  y -= 4;
  page.drawLine({
    start: { x: marge, y }, end: { x: rechts, y },
    thickness: 0.7, color: rgb(0.8, 0.8, 0.8),
  });
  y -= 14;
  page.drawText('Totaal afgeboekt', { x: kol.medewerker, y, size: 9, font: bold, color: zwart });
  drawRight(fmtUren(afgeboekt), kol.urenRechts, y, 9, bold, zwart);

  page.drawText(
    `Gegenereerd op ${fmtDatum(Date.now())}${BEDRIJFSNAAM ? ' door ' + BEDRIJFSNAAM : ''}`,
    { x: marge, y: 30, size: 8, font, color: grijs }
  );

  return doc.save();
}

async function uploadFile(bytes, fileName, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), fileName);
  fd.append('folderPath', '/strippenkaart-rapporten');
  fd.append('options', JSON.stringify({ access: 'PUBLIC_NOT_INDEXABLE', overwrite: false }));
  const res = await fetch(`${BASE}/files/v3/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Upload mislukt (${res.status}): ${t.slice(0, 200)}`);
  }
  return res.json();
}

exports.main = async (context = {}) => {
  try {
    const { companyId, format, van, tot, periodeLabel } = context.parameters || {};
    if (!companyId || !format) return { error: 'companyId of format ontbreekt' };

    const types = await getTypeIds();
    const bedrijfData = await api(`/crm/v3/objects/companies/${companyId}?properties=name`);
    const bedrijf = (bedrijfData.properties || {}).name || `Bedrijf ${companyId}`;

    const data = await getData(String(companyId));
    const kaart = data.actieve || data.kaarten[data.kaarten.length - 1];
    if (!kaart) return { error: 'Geen strippenkaart gevonden voor dit bedrijf.' };

    const alle = await getRegistratiesVoorKaart(types, kaart.id);
    const vanMs = num(van);
    const totMs = num(tot) || Date.now();
    const inPeriode = alle.filter((r) => (r.datum || 0) >= vanMs && (r.datum || 0) < totMs);
    const voorPeriode = alle.filter((r) => (r.datum || 0) < vanMs);
    const beginsaldo = kaart.totaal - voorPeriode.reduce((s, r) => s + r.uren, 0);
    const afgeboekt = inPeriode.reduce((s, r) => s + r.uren, 0);

    const slug = bedrijf.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const periodeSlug = String(periodeLabel || 'periode').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let upload;
    if (format === 'csv') {
      const csv = maakCsv(bedrijf, kaart, periodeLabel || '', inPeriode, beginsaldo, afgeboekt);
      upload = await uploadFile(
        Buffer.from(csv, 'utf8'),
        `urenrapport-${slug}-${periodeSlug}.csv`,
        'text/csv'
      );
    } else {
      const pdfBytes = await maakPdf(bedrijf, kaart, periodeLabel || '', inPeriode, beginsaldo, afgeboekt);
      upload = await uploadFile(
        Buffer.from(pdfBytes),
        `urenrapport-${slug}-${periodeSlug}.pdf`,
        'application/pdf'
      );
    }

    return { url: upload.url, naam: upload.name, format };
  } catch (e) {
    return { error: e.message };
  }
};
