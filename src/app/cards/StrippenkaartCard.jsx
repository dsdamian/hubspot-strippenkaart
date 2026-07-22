import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  DateInput,
  Divider,
  EmptyState,
  Flex,
  Heading,
  Input,
  Link,
  LoadingSpinner,
  NumberInput,
  ProgressBar,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Text,
  hubspot,
} from '@hubspot/ui-extensions';

hubspot.extend(({ context }) => <StrippenkaartCard context={context} />);

const WERKTYPES = [
  { label: 'Workflows & automatisering', value: 'workflows' },
  { label: 'Rapportages & dashboards', value: 'rapportages' },
  { label: 'Campagnes', value: 'campagnes' },
  { label: 'Support & vragen', value: 'support' },
  { label: 'Overleg', value: 'overleg' },
  { label: 'Overig', value: 'overig' },
];

const STATUS_LABELS = {
  actief: { label: 'Actief', variant: 'success' },
  bijna_op: { label: 'Bijna op', variant: 'warning' },
  verbruikt: { label: 'Verbruikt', variant: 'error' },
  verlopen: { label: 'Verlopen', variant: 'error' },
};

const fmtUren = (n) =>
  Number(n || 0)
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace('.', ',');

const fmtDatum = (ms) => {
  if (!ms) return '-';
  const d = new Date(Number(ms));
  return `${d.getUTCDate()}-${d.getUTCMonth() + 1}-${d.getUTCFullYear()}`;
};

const msNaarDateObj = (ms) => {
  if (!ms) return null;
  const d = new Date(Number(ms));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
};

const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

const maandOpties = () => {
  const nu = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(nu.getFullYear(), nu.getMonth() - i, 1));
    opts.push({
      label: `${MAANDEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      value: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
    });
  }
  opts.push({ label: 'Hele looptijd', value: 'alles' });
  return opts;
};

const StrippenkaartCard = ({ context }) => {
  const companyId = context.crm.objectId;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);

  const [uren, setUren] = useState(1);
  const [werktype, setWerktype] = useState('workflows');
  const [omschrijving, setOmschrijving] = useState('');
  const [datum, setDatum] = useState(null);

  const [bewerkId, setBewerkId] = useState(null);
  const [verwijderBevestig, setVerwijderBevestig] = useState(false);

  const [nieuwNaam, setNieuwNaam] = useState('HubSpot Strippenkaart');
  const [nieuwUren, setNieuwUren] = useState(50);
  const [nieuwTarief, setNieuwTarief] = useState(125);
  const [nieuwStart, setNieuwStart] = useState(null);

  const [kaartBewerken, setKaartBewerken] = useState(false);
  const [kaartNaam, setKaartNaam] = useState('');
  const [kaartStart, setKaartStart] = useState(null);
  const [kaartTotaal, setKaartTotaal] = useState(0);
  const [kaartTarief, setKaartTarief] = useState(0);

  const [toonAlles, setToonAlles] = useState(false);
  const [deelOpen, setDeelOpen] = useState(false);
  const [deelPeriode, setDeelPeriode] = useState(maandOpties()[1].value);
  const [deelBezig, setDeelBezig] = useState(null);
  const [deelLinks, setDeelLinks] = useState({});

  const laden = useCallback(async () => {
    try {
      setError(null);
      const res = await hubspot.serverless('get_strippenkaart_data', {
        parameters: { companyId },
      });
      if (res && res.error) throw new Error(res.error);
      setData(res);
    } catch (e) {
      setError(e.message || 'Kon strippenkaartdata niet laden');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    laden();
  }, [laden]);

  const resetForm = () => {
    setBewerkId(null);
    setVerwijderBevestig(false);
    setOmschrijving('');
    setUren(1);
    setDatum(null);
    setWerktype('workflows');
  };

  const logOfUpdate = async () => {
    if (!uren || uren <= 0) {
      setFlash({ variant: 'warning', text: 'Vul een aantal uren in (minimaal 0,25).' });
      return;
    }
    setSaving(true);
    setFlash(null);
    try {
      const fn = bewerkId ? 'update_uren' : 'log_uren';
      const res = await hubspot.serverless(fn, {
        parameters: {
          companyId,
          regId: bewerkId,
          uren,
          werktype,
          omschrijving,
          datum,
          medewerker: [context.user.firstName, context.user.lastName]
            .filter(Boolean)
            .join(' '),
        },
      });
      if (res && res.error) throw new Error(res.error);
      setData(res);
      setFlash({
        variant: 'success',
        text: bewerkId
          ? 'Registratie bijgewerkt en saldo gecorrigeerd.'
          : 'Uren gelogd en afgeboekt van de strippenkaart.',
      });
      resetForm();
    } catch (e) {
      setFlash({ variant: 'error', text: e.message || 'Opslaan mislukt' });
    } finally {
      setSaving(false);
    }
  };

  const startBewerken = (r) => {
    setBewerkId(r.id);
    setVerwijderBevestig(false);
    setUren(r.uren);
    setWerktype(r.werktype || 'overig');
    setOmschrijving(r.omschrijving || '');
    setDatum(msNaarDateObj(r.datum));
    setFlash(null);
  };

  const verwijderen = async (regId) => {
    setSaving(true);
    setFlash(null);
    try {
      const res = await hubspot.serverless('delete_uren', {
        parameters: { companyId, regId },
      });
      if (res && res.error) throw new Error(res.error);
      setData(res);
      resetForm();
      setFlash({ variant: 'success', text: 'Registratie verwijderd en saldo teruggeboekt.' });
    } catch (e) {
      setFlash({ variant: 'error', text: e.message || 'Verwijderen mislukt' });
    } finally {
      setSaving(false);
    }
  };

  const genereerRapport = async (format) => {
    setDeelBezig(format);
    setFlash(null);
    try {
      let van = 0;
      let tot = Date.now();
      let periodeLabel = 'Hele looptijd';
      if (deelPeriode !== 'alles') {
        const [jaar, maand] = deelPeriode.split('-').map(Number);
        van = Date.UTC(jaar, maand, 1);
        tot = Date.UTC(jaar, maand + 1, 1);
        periodeLabel = `${MAANDEN[maand]} ${jaar}`;
      }
      const res = await hubspot.serverless('deel_rapport', {
        parameters: { companyId, format, van, tot, periodeLabel },
      });
      if (res && res.error) throw new Error(res.error);
      setDeelLinks((prev) => ({ ...prev, [format]: res }));
    } catch (e) {
      setFlash({ variant: 'error', text: e.message || 'Rapport genereren mislukt' });
    } finally {
      setDeelBezig(null);
    }
  };

  const startKaartBewerken = () => {
    const k = data && data.actieve;
    if (!k) return;
    setKaartBewerken(true);
    setKaartNaam(k.naam);
    setKaartStart(msNaarDateObj(k.startdatum));
    setKaartTotaal(k.totaal);
    setKaartTarief(k.uurtarief);
    setFlash(null);
  };

  const opslaanKaart = async () => {
    if (!kaartTotaal || kaartTotaal <= 0) {
      setFlash({ variant: 'warning', text: 'Totaal uren moet groter dan 0 zijn.' });
      return;
    }
    setSaving(true);
    setFlash(null);
    try {
      const res = await hubspot.serverless('update_strippenkaart', {
        parameters: {
          companyId,
          kaartId: data.actieve.id,
          naam: kaartNaam,
          totaalUren: kaartTotaal,
          uurtarief: kaartTarief,
          startdatum: kaartStart,
        },
      });
      if (res && res.error) throw new Error(res.error);
      setData(res);
      setKaartBewerken(false);
      setFlash({ variant: 'success', text: 'Strippenkaart bijgewerkt.' });
    } catch (e) {
      setFlash({ variant: 'error', text: e.message || 'Bijwerken mislukt' });
    } finally {
      setSaving(false);
    }
  };

  const maakKaart = async () => {
    setSaving(true);
    setFlash(null);
    try {
      const res = await hubspot.serverless('create_strippenkaart', {
        parameters: {
          companyId,
          naam: nieuwNaam,
          totaalUren: nieuwUren,
          uurtarief: nieuwTarief,
          startdatum: nieuwStart,
        },
      });
      if (res && res.error) throw new Error(res.error);
      setData(res);
      setFlash({ variant: 'success', text: 'Nieuwe strippenkaart aangemaakt.' });
    } catch (e) {
      setFlash({ variant: 'error', text: e.message || 'Aanmaken mislukt' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Strippenkaart laden..." />;
  if (error) {
    return (
      <Alert title="Er ging iets mis" variant="error">
        <Text>{error}</Text>
      </Alert>
    );
  }

  const actieve = data && data.actieve;
  const toonLogForm = actieve || bewerkId;

  return (
    <Flex direction="column" gap="md">
      {flash && <Alert title={flash.text} variant={flash.variant} />}

      {!actieve && !bewerkId && (
        <>
          <EmptyState title="Geen actieve strippenkaart" layout="vertical" imageName="empty">
            <Text>Dit bedrijf heeft nog geen actieve strippenkaart. Maak er hieronder een aan.</Text>
          </EmptyState>
          <Flex direction="row" gap="sm">
            <Input label="Naam" name="nieuwNaam" value={nieuwNaam} onChange={setNieuwNaam} />
            <NumberInput label="Aantal uren" name="nieuwUren" value={nieuwUren} min={1} onChange={setNieuwUren} />
            <NumberInput label="Uurtarief (EUR)" name="nieuwTarief" value={nieuwTarief} min={0} precision={2} onChange={setNieuwTarief} />
            <DateInput label="Startdatum (leeg = vandaag)" name="nieuwStart" value={nieuwStart} onChange={setNieuwStart} />
          </Flex>
          <Box>
            <Button variant="primary" disabled={saving} onClick={maakKaart}>
              Strippenkaart aanmaken
            </Button>
          </Box>
        </>
      )}

      {actieve && (
        <>
          <Flex direction="row" justify="between" align="center">
            <Heading>{actieve.naam}</Heading>
            <Flex direction="row" gap="xs" justify="end">
              {!kaartBewerken && (
                <Button size="xs" disabled={saving} onClick={startKaartBewerken}>
                  Bewerk kaart
                </Button>
              )}
              <Button
                size="xs"
                disabled={saving}
                onClick={() => {
                  setDeelOpen(!deelOpen);
                  setFlash(null);
                }}
              >
                Delen
              </Button>
            </Flex>
          </Flex>

          {kaartBewerken && (
            <>
              <Divider />
              <Heading>Strippenkaart bewerken</Heading>
              <Flex direction="row" gap="sm">
                <Input label="Naam" name="kaartNaam" value={kaartNaam} onChange={setKaartNaam} />
                <DateInput label="Startdatum" name="kaartStart" value={kaartStart} onChange={setKaartStart} />
              </Flex>
              <Flex direction="row" gap="sm">
                <NumberInput
                  label="Totaal uren"
                  name="kaartTotaal"
                  value={kaartTotaal}
                  min={1}
                  precision={2}
                  onChange={setKaartTotaal}
                />
                <NumberInput
                  label="Uurtarief (EUR)"
                  name="kaartTarief"
                  value={kaartTarief}
                  min={0}
                  precision={2}
                  onChange={setKaartTarief}
                />
              </Flex>
              <Flex direction="row" gap="sm">
                <Button variant="primary" disabled={saving} onClick={opslaanKaart}>
                  {saving ? 'Bezig...' : 'Opslaan'}
                </Button>
                <Button disabled={saving} onClick={() => setKaartBewerken(false)}>
                  Annuleren
                </Button>
              </Flex>
            </>
          )}

          {deelOpen && (
            <>
              <Divider />
              <Heading>Rapport delen</Heading>
              <Text variant="microcopy">
                Genereer een overzicht van de mutaties voor de klant. Het bestand komt in
                HubSpot-bestanden te staan met een deelbare link.
              </Text>
              <Flex direction="row" gap="sm" align="end">
                <Select
                  label="Periode"
                  name="deelPeriode"
                  options={maandOpties()}
                  value={deelPeriode}
                  onChange={setDeelPeriode}
                />
                <Button
                  disabled={deelBezig !== null}
                  onClick={() => genereerRapport('pdf')}
                >
                  {deelBezig === 'pdf' ? 'Bezig...' : 'PDF-rapport'}
                </Button>
                <Button
                  disabled={deelBezig !== null}
                  onClick={() => genereerRapport('csv')}
                >
                  {deelBezig === 'csv' ? 'Bezig...' : 'CSV-export'}
                </Button>
              </Flex>
              {(deelLinks.pdf || deelLinks.csv) && (
                <Flex direction="column" gap="xs">
                  {deelLinks.pdf && (
                    <Text>
                      PDF klaar:{' '}
                      <Link href={deelLinks.pdf.url}>{deelLinks.pdf.naam || 'openen'}</Link>
                    </Text>
                  )}
                  {deelLinks.csv && (
                    <Text>
                      CSV klaar:{' '}
                      <Link href={deelLinks.csv.url}>{deelLinks.csv.naam || 'downloaden'}</Link>
                    </Text>
                  )}
                  <Text variant="microcopy">
                    Tip: open de link en stuur hem door naar de klant, of voeg het bestand als
                    bijlage toe aan je mail.
                  </Text>
                </Flex>
              )}
            </>
          )}

          <Flex direction="column" gap="xs">
            <Box>
              <Tag variant={(STATUS_LABELS[actieve.status] || STATUS_LABELS.actief).variant}>
                {(STATUS_LABELS[actieve.status] || STATUS_LABELS.actief).label}
              </Tag>
            </Box>
            <ProgressBar
              value={Math.max(0, actieve.resterend)}
              maxValue={actieve.totaal}
              showPercentage={false}
              variant={actieve.resterend / actieve.totaal <= 0.2 ? 'warning' : 'success'}
            />
            <Flex direction="row" justify="between" align="baseline">
              <Text>
                <Text format={{ fontWeight: 'bold' }} inline>
                  {fmtUren(actieve.resterend)}
                </Text>{' '}
                van {fmtUren(actieve.totaal)} uur resterend ({fmtUren(actieve.verbruikt)} verbruikt)
              </Text>
              <Text variant="microcopy">
                Gestart {fmtDatum(actieve.startdatum)}
                {actieve.geldigTot ? ` - geldig tot ${fmtDatum(actieve.geldigTot)}` : ''}
              </Text>
            </Flex>
          </Flex>

          {actieve.resterend / actieve.totaal <= 0.2 && actieve.resterend > 0 && (
            <Alert title="Strippenkaart bijna op" variant="warning">
              <Text>
                Nog {fmtUren(actieve.resterend)} uur over. Tijd om verlenging aan te kaarten bij de klant.
              </Text>
            </Alert>
          )}
        </>
      )}

      {toonLogForm && (
        <>
          <Divider />
          <Heading>{bewerkId ? 'Registratie bewerken' : 'Uren loggen'}</Heading>
          <Flex direction="row" gap="sm">
            <DateInput label="Datum" name="datum" value={datum} onChange={setDatum} />
            <NumberInput
              label="Uren"
              name="uren"
              value={uren}
              min={0.25}
              precision={2}
              onChange={setUren}
            />
            <Select
              label="Werktype"
              name="werktype"
              options={WERKTYPES}
              value={werktype}
              onChange={setWerktype}
            />
          </Flex>
          <Input
            label="Omschrijving"
            name="omschrijving"
            placeholder="Wat heb je gedaan?"
            value={omschrijving}
            onChange={setOmschrijving}
          />
          <Flex direction="row" gap="sm">
            <Button variant="primary" disabled={saving} onClick={logOfUpdate}>
              {saving ? 'Bezig...' : bewerkId ? 'Opslaan' : 'Loggen'}
            </Button>
            {bewerkId && (
              <Button disabled={saving} onClick={resetForm}>
                Annuleren
              </Button>
            )}
            {bewerkId && (
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() =>
                  verwijderBevestig ? verwijderen(bewerkId) : setVerwijderBevestig(true)
                }
              >
                {verwijderBevestig ? 'Zeker weten?' : 'Verwijder'}
              </Button>
            )}
          </Flex>
        </>
      )}

      {data && data.recent && data.recent.length > 0 && (
        <>
          <Divider />
          <Heading>Recente registraties</Heading>
          <Table bordered={false}>
            <TableHead>
              <TableRow>
                <TableHeader>Datum</TableHeader>
                <TableHeader>Omschrijving</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader>Uren</TableHeader>
                <TableHeader>Acties</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {(toonAlles ? data.recent : data.recent.slice(0, 5)).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDatum(r.datum)}</TableCell>
                  <TableCell>{r.omschrijving || '-'}</TableCell>
                  <TableCell>
                    {(WERKTYPES.find((w) => w.value === r.werktype) || {}).label || r.werktype || '-'}
                  </TableCell>
                  <TableCell>{fmtUren(r.uren)}</TableCell>
                  <TableCell>
                    <Link
                      onClick={() => {
                        if (!saving) startBewerken(r);
                      }}
                    >
                      Bewerk
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.recent.length > 5 && (
            <Box>
              <Link onClick={() => setToonAlles(!toonAlles)}>
                {toonAlles
                  ? '▲ Toon minder'
                  : `▼ Toon alle ${data.recent.length} registraties`}
              </Link>
            </Box>
          )}
        </>
      )}
    </Flex>
  );
};
