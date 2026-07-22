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
      'Custom objects "strippenkaart" en/of "urenregistratie" niet gevonden. Draai eerst setup/create_custom_objects.py.'
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

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const LOGO_SVG_PATH = "M71.8979523,36.8579452 C72.0528897,37.049473 72.2055401,37.2129862 72.3301761,37.3959381 C73.5839682,39.2374631 74.8068872,41.1012855 76.0995566,42.9159394 C76.5123418,43.4956682 76.4969052,43.8964472 76.119567,44.4870387 C72.0568917,50.8457601 67.9850689,57.1999077 63.9961461,63.6055105 C60.6572742,68.9665724 60.4720354,74.6237877 62.7332064,80.4302231 C65.5192205,87.5853569 74.844621,93.5438711 82.8247535,92.757178 C88.8347229,92.1642995 93.5949022,89.4366013 96.9989507,84.4311521 C98.1807055,82.6925375 99.2658388,80.8887463 100.43959,79.0449343 C100.593955,79.2050172 100.705441,79.2919194 100.780909,79.4039774 C102.331998,81.6903042 103.867079,83.9880655 105.435891,86.2618144 C105.73376,86.6940382 105.759487,87.0044847 105.447897,87.4424258 C100.427583,94.4997947 93.728114,98.8403281 85.0939286,100.068964 C84.8337939,100.105555 84.578233,100.183309 84.3209569,100.242197 C82.8339011,100.25992 81.3468453,100.277644 79.8597895,100.295367 C78.0251252,99.9586215 76.1212822,99.8328421 74.3689461,99.2508264 C64.0624661,95.8284827 56.7586839,89.3988675 54.372877,78.4086048 C52.8955406,71.6033665 54.1293223,65.1623167 57.817518,59.2541143 C62.2060763,52.2224731 66.6763912,45.242287 71.1072571,38.236945 C71.3765394,37.8115819 71.6098031,37.3633498 71.8979523,36.8579452 Z M96.1024864,4.07525463 C101.614484,0.444803195 108.231625,-0.8175648 114.736707,0.520270847 C121.240075,1.85924994 126.821823,5.63206081 130.452846,11.144058 L130.452846,11.144058 L158.325565,53.4619721 L162.114956,59.0831687 C162.10295,59.109468 162.093231,59.1374825 162.081225,59.1637819 L162.081225,59.1637819 L162.785018,60.2323352 C170.305483,71.6513913 167.134699,87.0610854 155.715642,94.582123 L155.715642,94.582123 L154.782588,95.1961553 C150.59985,97.951868 145.88255,99.2714085 141.213275,99.2776974 C133.134235,99.2879885 125.198697,95.3636706 120.432228,88.1267801 L120.432228,88.1267801 L119.236752,86.3109827 C119.245328,86.2881137 119.253332,86.2641013 119.261908,86.2406606 L119.261908,86.2406606 L88.1583726,40.1024825 C87.8599324,39.6599676 87.5837894,39.2094486 87.3173657,38.7549276 L87.3173657,38.7549276 L83.2981415,32.7924113 L78.835259,26.0340544 C78.8381176,26.0306241 78.841548,26.0277654 78.8449783,26.0243351 L78.8449783,26.0243351 L73.1437403,17.3455551 C72.8430131,16.8321464 72.5177018,16.3341743 72.1655194,15.8562125 C70.9729018,14.2353731 69.4961371,12.8220698 67.768957,11.6877681 L67.768957,11.6877681 L66.8359024,11.0754511 C63.992144,9.20762668 60.7253095,8.24141205 57.3778617,8.24141205 C56.1863876,8.24141205 54.9846224,8.36433284 53.7885745,8.61246133 C52.5868093,8.86116155 51.437071,9.23907153 50.3405032,9.71703333 C50.3336425,9.72446575 50.3267818,9.73132644 50.3204928,9.73933059 C50.0437781,9.85310379 49.7739241,9.98288528 49.5029266,10.1109516 C49.2868147,10.2190076 49.0672724,10.3207745 48.856306,10.4374064 L48.856306,10.4374064 C46.3458632,11.7495144 44.1218543,13.675083 42.4632812,16.2078231 L42.4632812,16.2078231 L28.7739065,37.1123627 L26.4321224,40.7731155 C26.4012493,40.7885521 26.372663,40.8085624 26.3423616,40.8251425 L26.3423616,40.8251425 L10.2608911,65.3812873 C7.73329646,69.241572 6.86427502,73.8759719 7.81390964,78.4320455 C8.76411598,82.9875474 11.4134879,86.8889963 15.2737727,89.4171627 L15.2737727,89.4171627 L16.2079707,90.028908 C19.0997539,91.9236035 22.3540106,92.8355042 25.5779658,92.8560863 C25.579681,92.8537994 25.5819679,92.8520843 25.5831113,92.8497974 C25.7917908,92.8566581 25.9993268,92.8503691 26.2080063,92.8492256 C31.691989,92.6868558 37.0164606,89.943721 40.2432744,85.0165981 L40.2432744,85.0165981 L46.4682122,75.5111043 C46.5688358,76.4698866 46.7186276,77.4349577 46.9301657,78.4086048 C47.4492917,80.8018441 48.214831,82.9663936 49.1810456,84.9428457 L49.1810456,84.9428457 L46.4653536,89.0901362 C41.7171805,96.3401763 33.7936488,100.285076 25.7140362,100.295412 C21.0447611,100.301656 16.3217439,98.9929786 12.1327175,96.249272 L12.1327175,96.249272 L11.1990912,95.6380984 C5.67737468,92.0219401 1.89027069,86.4510552 0.534139858,79.9499744 C-0.821419252,73.4494653 0.423225279,66.8283223 4.0393836,61.3071775 L4.0393836,61.3071775 L22.52953,33.0725564 L26.7717268,26.4405506 C26.8386186,26.3970996 26.898078,26.3462161 26.9632546,26.3021933 L26.9632546,26.3021933 L36.2417737,12.1342851 C39.0906775,7.78346061 43.0858893,4.6292558 47.5704973,2.79573489 C47.7014223,2.74027761 47.8357776,2.69168101 47.9678459,2.6379389 C48.1090619,2.58362506 48.2485627,2.52416569 48.3909222,2.47213875 C49.6424274,1.99360523 50.9396706,1.6076911 52.2792214,1.32983293 C58.7820174,-0.0171503103 65.4008735,1.23664181 70.9180162,4.8590891 L70.9180162,4.8590891 L71.8516426,5.47197791 C74.2334474,7.03678824 76.2899409,8.96635888 77.9685245,11.1760746 C77.9742417,11.1743594 77.9793872,11.1715008 77.9851045,11.1697856 L77.9851045,11.1697856 L78.1537632,11.4259183 C78.2349481,11.5362611 78.3087006,11.6517495 78.3881703,11.7626641 L78.3881703,11.7626641 L79.5642079,13.5681705 C79.5819314,13.5984719 79.60137,13.6270581 79.6190935,13.6573595 L79.6190935,13.6573595 L79.9678455,14.18792 L83.2706987,19.2596892 L87.0658068,13.4160917 L87.468301,12.7957705 C87.8319179,12.1754493 88.2258361,11.5739949 88.6414799,10.9885489 C88.7209497,10.8770626 88.7947021,10.7615742 88.875887,10.6518031 L88.875887,10.6518031 L89.0439741,10.3950987 C89.0496913,10.3973856 89.0548369,10.4002443 89.0605541,10.4019594 C90.736279,8.1893851 92.7899139,6.25695584 95.1700036,4.68928689 L95.1700036,4.68928689 Z M254.738921,77.569313 C256.213399,77.569313 257.516359,78.0123996 258.500297,78.7739368 L258.500297,77.8643229 L261.033037,77.8643229 L261.033037,89.7396153 C261.033037,93.2551501 258.648374,95.3699596 255.180864,95.3699596 C251.936327,95.3699596 249.551092,93.4523951 249.230926,90.6978258 L251.83799,90.6978258 C252.058676,92.0996946 253.288456,93.0590486 255.180864,93.0590486 C257.123584,93.0590486 258.500297,91.853853 258.500297,89.7396153 L258.500297,87.9198158 C257.516359,88.6819248 256.213399,89.1244396 254.738921,89.1244396 C251.492668,89.1244396 248.935916,86.5190905 248.935916,83.4209147 C248.935916,79.9785606 251.492668,77.569313 254.738921,77.569313 Z M109.647215,7.43869466 C106.299767,7.44328445 103.034648,8.41407289 100.193176,10.2853276 L100.193176,10.2853276 L99.261265,10.8999316 C97.5358001,12.0359484 96.0607505,13.4509669 94.8698481,15.0735214 C94.6594535,15.3599555 94.4770733,15.6663999 94.2849738,15.9659836 C94.2889759,15.9854222 94.2918345,16.0042891 94.2958366,16.0231561 C93.9676666,16.4868247 93.6612222,16.9647865 93.3799337,17.4593283 L93.3799337,17.4593283 L87.7793192,26.2398753 L106.959537,54.9307327 L106.987552,54.9118657 C107.254547,55.3332268 107.559276,55.6796919 107.892592,55.9947122 C107.926895,56.045024 107.970346,56.0901902 108.006365,56.1393585 L108.006365,56.1393585 L108.106417,56.2880069 C108.09098,56.2988697 108.074972,56.308589 108.059535,56.3188801 L108.059535,56.3188801 L121.352133,76.037091 L121.352133,76.037091 L121.352705,76.003931 L122.313202,77.4629723 L127.181438,84.6844261 C127.551915,85.2344252 127.951551,85.7529795 128.371768,86.2458061 C134.028412,92.395848 143.491026,93.7285381 150.691326,88.9872257 L150.691326,88.9872257 L151.623237,88.3726217 C159.61995,83.1058944 161.839957,72.3174505 156.573801,64.3224532 L156.573801,64.3224532 L152.137218,57.5869653 L145.402873,47.5977925 C145.42174,47.5417635 145.429173,47.4840193 145.446325,47.428562 L145.446325,47.428562 L124.24163,15.2347478 C121.704316,11.3813237 117.796006,8.74281455 113.237074,7.80461442 C112.041026,7.55820111 110.838689,7.43756721 109.647215,7.43869466 Z M239.493884,77.569313 C240.969505,77.569313 242.222725,78.0123996 243.206092,78.7739368 L243.206092,77.8643229 L245.738832,77.8643229 L245.738832,89.4200213 L243.206092,89.4200213 L243.206092,88.5098357 C242.222725,89.2725163 240.969505,89.7144595 239.493884,89.7144595 C236.248775,89.7144595 233.64171,87.0107737 233.64171,83.6416004 C233.64171,80.2741423 236.248775,77.569313 239.493884,77.569313 Z M277.18826,77.569313 C280.089191,77.569313 282.400102,79.413125 282.818033,82.0682142 L280.212684,82.0682142 C279.891946,80.7652537 278.736491,79.880224 277.18826,79.880224 C275.048295,79.880224 273.646998,81.5519468 273.646998,83.6416004 C273.646998,85.7323974 275.048295,87.4041202 277.18826,87.4041202 C278.736491,87.4041202 279.891946,86.5190905 280.212684,85.2149866 L282.818033,85.2149866 C282.400102,87.8706475 280.089191,89.7144595 277.18826,89.7144595 C273.721322,89.7144595 271.090246,87.0839544 271.090246,83.6416004 C271.090246,80.224974 273.721322,77.569313 277.18826,77.569313 Z M225.649,77.569313 C228.673995,77.569313 230.738493,79.3885408 230.738493,82.8063107 L230.738493,89.4200213 L228.207468,89.4200213 L228.207468,82.8063107 C228.207468,80.7652537 227.124621,79.880224 225.476911,79.880224 C224.347183,79.880224 223.264336,80.2981547 222.403891,81.4536102 C222.478215,81.8229443 222.502227,82.2403033 222.502227,82.6588057 L222.502227,89.4200213 L219.970059,89.4200213 L219.970059,82.6588057 C219.970059,80.6177488 218.887784,79.880224 217.388722,79.880224 C216.184098,79.880224 215.101824,80.3719072 214.266534,81.5273627 L214.266534,89.4200213 L211.70921,89.4200213 L211.70921,77.8643229 L214.266534,77.8643229 L214.266534,78.848261 C215.12698,78.0609962 216.158943,77.569313 217.68316,77.569313 C219.330871,77.569313 220.658987,78.1347487 221.518289,79.2410359 C222.650304,78.1347487 223.953265,77.569313 225.649,77.569313 Z M267.69706,77.8643229 L267.69706,89.4200213 L265.16432,89.4200213 L265.16432,77.8643229 L267.69706,77.8643229 Z M239.862646,79.880224 C237.748408,79.880224 236.198463,81.576531 236.198463,83.6416004 C236.198463,85.7072415 237.748408,87.4041202 239.862646,87.4041202 C241.141594,87.4041202 242.345646,86.9610336 243.206092,85.7323974 L243.206092,81.5519468 C242.345646,80.3227389 241.141594,79.880224 239.862646,79.880224 Z M255.10654,79.7573032 C252.96829,79.7573032 251.492668,81.2815211 251.492668,83.4209147 C251.492668,85.1904024 252.96829,86.9118653 255.10654,86.9118653 C256.386631,86.9118653 257.639852,86.4201821 258.500297,85.1418058 L258.500297,81.5519468 C257.639852,80.2741423 256.386631,79.7573032 255.10654,79.7573032 Z M266.418684,72.0378772 C267.303713,72.0378772 268.041238,72.7016495 268.041238,73.6112634 C268.041238,74.5203056 267.303713,75.1840779 266.418684,75.1840779 C265.508498,75.1840779 264.796129,74.5203056 264.796129,73.6112634 C264.796129,72.7016495 265.508498,72.0378772 266.418684,72.0378772 Z M306.805883,43.7449402 C308.280361,43.7449402 309.584465,44.187455 310.56726,44.949564 L310.56726,44.0399501 L313.1,44.0399501 L313.1,55.9146708 C313.1,59.4307773 310.715337,61.545015 307.248398,61.545015 C304.003289,61.545015 301.618626,59.6274505 301.297888,56.873453 L303.904953,56.873453 C304.12621,58.27475 305.355418,59.234104 307.248398,59.234104 C309.191119,59.234104 310.56726,58.0294802 310.56726,55.9146708 L310.56726,54.095443 C309.584465,54.8575519 308.280361,55.3000668 306.805883,55.3000668 C303.559631,55.3000668 301.00345,52.6947176 301.00345,49.5965418 C301.00345,46.1541878 303.559631,43.7449402 306.805883,43.7449402 Z M272.603029,39.7863188 L272.603029,44.0399501 L276.881244,44.0399501 L276.881244,46.1787719 L272.603029,46.1787719 L272.603029,51.1453438 C272.603029,52.816495 273.43889,53.530579 274.864772,53.530579 C275.5537,53.530579 276.242056,53.3339057 276.832076,53.0874924 L277.200267,55.4229876 C276.192888,55.7923217 275.356455,55.8900866 274.56919,55.8900866 C271.619091,55.8900866 270.045705,54.1205988 270.045705,51.1453438 L270.045705,46.1787719 L267.316863,46.1787719 L267.316863,44.0399501 L270.045705,44.0399501 L270.045705,39.7863188 L272.603029,39.7863188 Z M260.012509,43.7449402 C263.84821,43.7449402 266.233445,46.6698834 265.741762,50.5793365 L256.669635,50.5793365 C256.914905,52.3253835 258.02062,53.6529281 260.184598,53.6529281 C261.316041,53.6529281 262.176487,53.3087499 262.643586,52.5712251 L265.44618,52.5712251 C264.709227,54.6608786 262.668742,55.8900866 260.160586,55.8900866 C256.521558,55.8900866 254.062571,53.2595815 254.062571,49.8172275 C254.062571,46.4006011 256.497546,43.7449402 260.012509,43.7449402 Z M221.753268,43.7449402 C223.228318,43.7449402 224.481538,44.187455 225.465476,44.949564 L225.465476,44.0399501 L227.997645,44.0399501 L227.997645,55.5956484 L225.465476,55.5956484 L225.465476,54.6854628 C224.481538,55.4475717 223.228318,55.8900866 221.753268,55.8900866 C218.508159,55.8900866 215.900523,53.1858291 215.900523,49.8172275 C215.900523,46.4491977 218.508159,43.7449402 221.753268,43.7449402 Z M207.908384,43.7449402 C210.933379,43.7449402 212.997877,45.564168 212.997877,48.9813661 L212.997877,55.5956484 L210.465709,55.5956484 L210.465709,48.9813661 C210.465709,46.9408809 209.384006,46.0552794 207.736295,46.0552794 C206.605424,46.0552794 205.523721,46.4737819 204.663275,47.6292373 C204.737028,47.9985715 204.76104,48.4159304 204.76104,48.8344329 L204.76104,55.5956484 L202.229444,55.5956484 L202.229444,48.8344329 C202.229444,46.7933759 201.147169,46.0552794 199.647535,46.0552794 C198.442911,46.0552794 197.361208,46.5481061 196.525919,47.7029898 L196.525919,55.5956484 L193.968594,55.5956484 L193.968594,44.0399501 L196.525919,44.0399501 L196.525919,45.0233165 C197.385792,44.2366234 198.418327,43.7449402 199.942545,43.7449402 C201.590255,43.7449402 202.917228,44.3103758 203.777674,45.4160913 C204.909689,44.3103758 206.212649,43.7449402 207.908384,43.7449402 Z M238.595704,43.7935368 L238.595704,46.2033561 C236.751892,46.2771086 235.350595,46.965465 234.31806,48.3175938 L234.31806,55.5956484 L231.760736,55.5956484 L231.760736,44.0399501 L234.31806,44.0399501 L234.31806,45.6133363 C235.375751,44.4573091 236.826216,43.7935368 238.595704,43.7935368 Z M243.834417,38.1391801 L243.834417,49.4976334 L249.268088,44.0399501 L252.513197,44.0399501 L247.767882,48.859017 L253.25015,55.5956484 L249.931289,55.5956484 L246.021835,50.6536607 L243.834417,52.866235 L243.834417,55.5956484 L241.277664,55.5956484 L241.277664,38.1391801 L243.834417,38.1391801 Z M293.356061,43.7449402 C296.354757,43.7449402 298.395242,45.8100095 298.395242,49.1534552 L298.395242,55.5956484 L295.83849,55.5956484 L295.83849,49.3009602 C295.83849,47.1872942 294.707047,46.0552794 292.838651,46.0552794 C291.732363,46.0552794 290.52774,46.6698834 289.618698,47.8013265 L289.618698,55.5956484 L287.061373,55.5956484 L287.061373,44.0399501 L289.618698,44.0399501 L289.618698,45.0724848 C290.625505,44.2120392 291.88044,43.7449402 293.356061,43.7449402 Z M282.955247,44.0399501 L282.955247,55.5956484 L280.422507,55.5956484 L280.422507,44.0399501 L282.955247,44.0399501 Z M222.122031,46.0552794 C220.007221,46.0552794 218.457847,47.7521581 218.457847,49.8172275 C218.457847,51.8828686 220.007221,53.5786039 222.122031,53.5786039 C223.400407,53.5786039 224.605031,53.1366607 225.465476,51.9080245 L225.465476,47.727574 C224.605031,46.498366 223.400407,46.0552794 222.122031,46.0552794 Z M307.174646,45.9329303 C305.035824,45.9329303 303.559631,47.4565765 303.559631,49.5965418 C303.559631,51.3660296 305.035824,53.0874924 307.174646,53.0874924 C308.453594,53.0874924 309.706814,52.5958092 310.56726,51.317433 L310.56726,47.727574 C309.706814,46.4491977 308.453594,45.9329303 307.174646,45.9329303 Z M260.037093,45.9077745 C258.1201,45.9077745 257.013242,47.1872942 256.718803,48.8098487 L263.20845,48.8098487 C263.062088,46.9162967 261.832309,45.9077745 260.037093,45.9077745 Z M281.676871,38.2129326 C282.5619,38.2129326 283.299425,38.8767049 283.299425,39.7863188 C283.299425,40.6959327 282.5619,41.359705 281.676871,41.359705 C280.766113,41.359705 280.054316,40.6959327 280.054316,39.7863188 C280.054316,38.8767049 280.766113,38.2129326 281.676871,38.2129326 Z M235.354025,12.7111552 C239.189154,12.7111552 241.57439,15.6360985 241.082706,19.5455515 L232.01058,19.5455515 C232.25585,21.2910268 233.362137,22.6191432 235.525543,22.6191432 C236.657558,22.6191432 237.517432,22.2743932 237.984531,21.5374402 L240.787696,21.5374402 C240.050172,23.6270937 238.009686,24.8563017 235.50153,24.8563017 C231.862503,24.8563017 229.403515,22.2252249 229.403515,18.7834426 C229.403515,15.3662444 231.838491,12.7111552 235.354025,12.7111552 Z M206.609426,12.7111552 C208.084476,12.7111552 209.338268,13.1525267 210.321062,13.9152073 L210.321062,13.0061652 L212.854374,13.0061652 L212.854374,24.5612918 L210.321062,24.5612918 L210.321062,23.6511061 C209.338268,24.4137868 208.084476,24.8563017 206.609426,24.8563017 C203.364317,24.8563017 200.757253,22.1520441 200.757253,18.7834426 C200.757253,15.4154128 203.364317,12.7111552 206.609426,12.7111552 Z M192.764542,12.7111552 C195.789537,12.7111552 197.854607,14.5298113 197.854607,17.9475812 L197.854607,24.5612918 L195.322438,24.5612918 L195.322438,17.9475812 C195.322438,15.9065242 194.240735,15.0214945 192.593025,15.0214945 C191.462154,15.0214945 190.379879,15.4394252 189.520005,16.5948807 C189.593757,16.9642148 189.61777,17.3815738 189.61777,17.8000762 L189.61777,24.5612918 L187.086173,24.5612918 L187.086173,17.8000762 C187.086173,15.759591 186.003327,15.0214945 184.503693,15.0214945 C183.299641,15.0214945 182.216794,15.5137494 181.381505,16.6692049 L181.381505,24.5612918 L178.825324,24.5612918 L178.825324,13.0061652 L181.381505,13.0061652 L181.381505,13.9889598 C182.24195,13.2022667 183.274485,12.7111552 184.799275,12.7111552 C186.446985,12.7111552 187.773958,13.2760192 188.634403,14.3823064 C189.765275,13.2760192 191.069379,12.7111552 192.764542,12.7111552 Z M219.17479,7.10482347 L219.17479,18.4638485 L224.608461,13.0061652 L227.852998,13.0061652 L223.107684,17.8246604 L228.591095,24.5612918 L225.271662,24.5612918 L221.362208,19.6198757 L219.17479,21.8324501 L219.17479,24.5612918 L216.617466,24.5612918 L216.617466,7.10482347 L219.17479,7.10482347 Z M206.97876,15.0214945 C204.863951,15.0214945 203.314577,16.7178015 203.314577,18.7834426 C203.314577,20.848512 204.863951,22.544819 206.97876,22.544819 C208.256565,22.544819 209.46176,22.1023041 210.321062,20.8736679 L210.321062,16.6937891 C209.46176,15.4640094 208.256565,15.0214945 206.97876,15.0214945 Z M235.379181,14.8739895 C233.461045,14.8739895 232.35533,16.1529375 232.059748,17.7754921 L238.549394,17.7754921 C238.403033,15.8825118 237.173253,14.8739895 235.379181,14.8739895 Z";
const LOGO_VIEWBOX = { w: 314, h: 101 };

// ── JE EIGEN LOGO ─────────────────────────────────────────────────────────
// Makkelijkste manier: plak hieronder je logo als base64-PNG. Werkt met elk
// logo, ook met meerdere kleuren en transparantie. Zet het om met dit commando:
//   macOS/Linux:  base64 -i logo.png | pbcopy      (staat daarna op je klembord)
//   of online:    zoek op "png to base64" en plak het resultaat hieronder.
// Laat de string leeg ('') om terug te vallen op het enkelpad-SVG hierboven.
const LOGO_PNG_BASE64 = '';
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
    // Fallback: enkelpad-SVG (zoals het MMM-logo)
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
    `Gegenereerd op ${fmtDatum(Date.now())} door Make Marketing Magic`,
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
