import { useMemo, useState } from "react";

import {
  ingestOpenAqCountries,
  ingestOpenAqInstruments,
  ingestOpenAqParameters,
  ingestOpenAqProviders,
  type OpenAqCatalog,
} from "@patool/shared";

import { Card, DataTable, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

const SAMPLE_OPENAQ = `{
  "countries":   { "results": [{"id":1,"code":"US","name":"United States"},{"id":2,"code":"IN","name":"India"},{"id":3,"code":"GB","name":"United Kingdom"}] },
  "providers":   { "results": [{"id":10,"name":"AirNow","sourceType":"federal"},{"id":11,"name":"OpenAQ","sourceType":"network"}] },
  "instruments": { "results": [{"id":21,"name":"BAM-1020","manufacturer":{"id":99,"name":"Met One"}},{"id":22,"name":"Teledyne T640","manufacturer":{"id":100,"name":"Teledyne"}}] },
  "parameters":  { "results": [{"id":2,"name":"pm25","units":"ug/m3","displayName":"PM2.5"}, {"id":3,"name":"o3","units":"ppb","displayName":"O3"}] }
}`;

const LOADER_REFERENCE = [
  {
    name: "AIRSIS annual",
    description: "USFS smoke monitor archive (per unit, per year).",
    fn: "airsisLoadAnnual({ fetcher, year, unitId })",
    example: "https://airfire-data-exports.s3.amazonaws.com/monitoring/v2/airsis_USFS101_2024.csv",
  },
  {
    name: "WRCC annual",
    description: "Western Regional Climate Center temporary monitors.",
    fn: "wrccLoadAnnual({ fetcher, year, station })",
    example: "https://wrcc.dri.edu/cgi-bin/wea_daysum.pl?stn=DFLT&yr=2024",
  },
  {
    name: "AirNow daily",
    description: "EPA AirNow hourly file for a single UTC date.",
    fn: "airnowLoadDaily({ fetcher, date })",
    example: "https://files.airnowtech.org/airnow/2024/20240704/HourlyData_20240704.dat",
  },
  {
    name: "EPA AQS annual",
    description: "Historical regulatory measurements per pollutant.",
    fn: "epaAqsLoadAnnual({ fetcher, year, parameter })",
    example: "https://aqs.epa.gov/aqsweb/airdata/hourly_pm25_2024.zip",
  },
  {
    name: "Clarity / OpenAQ latest",
    description: "OpenAQ v3 measurements feed (Clarity provider filter).",
    fn: "clarityLoadLatest({ fetcher, countryCode })",
    example: "https://api.openaq.org/v3/measurements?parameter=pm25&provider=clarity&country=US",
  },
];

export default function MultiSourceLoadersPage() {
  const [text, setText] = useState(SAMPLE_OPENAQ);
  const catalog = useMemo<OpenAqCatalog>(() => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return {
        countries: ingestOpenAqCountries(parsed.countries),
        providers: ingestOpenAqProviders(parsed.providers),
        instruments: ingestOpenAqInstruments(parsed.instruments),
        parameters: ingestOpenAqParameters(parsed.parameters),
        manufacturers: [],
        licenses: [],
      };
    } catch {
      return { countries: [], providers: [], instruments: [], parameters: [], manufacturers: [], licenses: [] };
    }
  }, [text]);

  const cols: Column<typeof LOADER_REFERENCE[number]>[] = [
    { key: "name", header: "Loader", render: (row) => row.name },
    { key: "desc", header: "Description", render: (row) => row.description },
    { key: "fn", header: "Function", render: (row) => <code>{row.fn}</code> },
    { key: "ex", header: "Example URL", render: (row) => <code>{row.example}</code> },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="AirMonitor loaders"
        title="Multi-source ingest + OpenAQ catalog"
        subtitle="Typed adapters for AIRSIS, WRCC, AirNow, EPA AQS, and Clarity. Paste an OpenAQ v3 catalog payload to inspect the typed ingest."
      />
      <div className={styles.stats}>
        <StatCard label="Loaders" value={String(LOADER_REFERENCE.length)} />
        <StatCard label="Countries" value={String(catalog.countries.length)} />
        <StatCard label="Providers" value={String(catalog.providers.length)} />
        <StatCard label="Instruments" value={String(catalog.instruments.length)} />
      </div>

      <Card title="Loader reference">
        <DataTable columns={cols} data={LOADER_REFERENCE} rowKey={(r) => r.name} pageSize={10} />
      </Card>

      <Card title="OpenAQ catalog ingest">
        <textarea
          rows={12}
          spellCheck={false}
          className={styles.textarea}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Card>

      <Card title="Parameters">
        <DataTable
          columns={[
            { key: "id", header: "ID", render: (r) => r.id },
            { key: "name", header: "Name", render: (r) => r.name },
            { key: "units", header: "Units", render: (r) => r.units },
          ]}
          data={catalog.parameters}
          rowKey={(r) => String(r.id)}
          pageSize={8}
        />
      </Card>
    </div>
  );
}
