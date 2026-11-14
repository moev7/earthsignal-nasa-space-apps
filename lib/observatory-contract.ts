import { z } from "zod";
import { gaugeVintageSchema } from "./gauge-vintage-contract";
import { forecastInformationSchema } from "./forecast-information-contract";
import { historyAnalysisSchema, gaugeEvaluationSchema, forecastSchema, weightSweepSchema, stationSeasonalTrendSchema, seasonalSamplingSchema } from "./science-analytics";

export const DOMAINS = ["water", "fire", "ecology", "urban"] as const;
export const QUESTIONS = ["change", "seasonal", "explain", "exposure", "future", "options"] as const;
export const QUESTION_LABELS: Record<(typeof QUESTIONS)[number], string> = {
  change: "What changed here?", seasonal: "Is this unusual for this season?",
  explain: "What might explain it?", exposure: "Which places overlap the change?",
  future: "What could happen under different conditions?", options: "Which options remain useful?",
};
const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-85).max(85)]);
const ring = z.array(position).min(4).max(512).refine(r => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1], "Close every polygon ring");
const polygon = z.array(ring).min(1).max(16);
export const areaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygon }).strict(),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1).max(16) }).strict(),
]).superRefine((a, ctx) => {
  const polygons = a.type === "Polygon" ? [a.coordinates] : a.coordinates;
  if (polygons.reduce((n, p) => n + p.reduce((sum, r) => sum + r.length, 0), 0) > 512)
    ctx.addIssue({ code: "custom", message: "Use at most 512 geometry positions" });
  // Topology and unwrapped antimeridian geometry are validated independently by the science service.
});
export type AssessmentArea = z.infer<typeof areaSchema>;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Use a real calendar date");
const identifier = z.string().min(1).max(220).regex(/^[^\x00-\x1f]+$/);
export const assessmentRequestSchema = z.object({
  schemaVersion: z.literal("1.0"), domain: z.enum(DOMAINS), question: z.enum(QUESTIONS),
  area: areaSchema, start: date, end: date,
  options: z.object({ sourceIds: z.array(identifier).max(16).optional(), gaugeId: z.string().max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(), referenceStart: date.optional(), referenceEnd: date.optional() }).strict().optional(),
}).strict().refine(a => a.start <= a.end, "Start must precede end").refine(a => Boolean(a.options?.referenceStart) === Boolean(a.options?.referenceEnd), "Provide both baseline dates").refine(a => !a.options?.referenceStart || !a.options.referenceEnd || a.options.referenceStart <= a.options.referenceEnd, "Baseline start must precede end").refine(a=>!a.options?.sourceIds || new Set(a.options.sourceIds).size===a.options.sourceIds.length,"Choose unique source IDs");
export type AssessmentRequest = z.infer<typeof assessmentRequestSchema>;
const timestamp = z.string().datetime({ offset: true });
const strings = z.array(z.string());
const transitionCount = z.number().int().min(0).max(1_000_000);
const transitionCountsSchema = z.object({gain:transitionCount,loss:transitionCount,persistentClass1:transitionCount,nonClass1Both:transitionCount,unknown:transitionCount}).strict();
const transitionArea = z.number().finite().nonnegative();
export const waterTransitionAccountingSchema = z.object({
  methodVersion:z.literal('class1-common-pixel-transition-v1'),classDefinition:z.literal('mapped-class1-indicator'),
  totalPixels:z.number().int().positive().max(1_000_000),validPixels:z.number().int().positive().max(1_000_000),pixelAreaKm2:z.number().finite().positive(),
  counts:transitionCountsSchema,areasKm2:z.object({gain:transitionArea,loss:transitionArea,persistentClass1:transitionArea,nonClass1Both:transitionArea,unknown:transitionArea}).strict(),
  netChangeKm2:z.number().finite(),turnoverKm2:transitionArea,
  hashes:z.object(Object.fromEntries(['grid','areaMask','commonMask','beforeIndicator','afterIndicator','categories'].map(k=>[k,z.string().regex(/^[a-f0-9]{64}$/)])) as Record<'grid'|'areaMask'|'commonMask'|'beforeIndicator'|'afterIndicator'|'categories',z.ZodString>).strict(),
}).strict().superRefine((r,ctx)=>{
  const equal=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-15,1e-12*Math.max(Math.abs(a),Math.abs(b)));
  const c=r.counts;
  if(c.gain+c.loss+c.persistentClass1+c.nonClass1Both!==r.validPixels||r.validPixels+c.unknown!==r.totalPixels)ctx.addIssue({code:'custom',message:'Transition populations do not reconcile'});
  for(const k of Object.keys(c) as (keyof typeof c)[])if(!equal(r.areasKm2[k],c[k]*r.pixelAreaKm2))ctx.addIssue({code:'custom',message:'Transition mapped areas do not reconcile'});
  if(!equal(r.netChangeKm2,(c.gain-c.loss)*r.pixelAreaKm2)||!equal(r.turnoverKm2,(c.gain+c.loss)*r.pixelAreaKm2))ctx.addIssue({code:'custom',message:'Transition change and turnover do not reconcile'});
});
export type WaterTransitionAccounting=z.infer<typeof waterTransitionAccountingSchema>;
const rasterFilePair=z.object({raster:z.string(),preview:z.string()}).strict();
export const rasterFilesSchema=z.object({before:rasterFilePair,after:rasterFilePair,difference:rasterFilePair,excluded:rasterFilePair,transition:rasterFilePair.optional()}).strict();
export const rasterViewSchema = z.object({
  id: z.enum(['ndvi','ndmi','temperature','water']), quantity:z.string(),unit:z.string(),
  bounds:z.tuple([z.tuple([z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite()])]),
  grid:z.object({crs:z.string(),resolution:z.number().positive(),transform:z.array(z.number().finite()).length(6),width:z.number().int().positive(),height:z.number().int().positive(),aggregation:z.record(z.number().int()),aoiPolicy:z.string()}),
  before:z.object({date:timestamp,evidenceId:z.string(),coveragePercent:z.number().min(0).max(100)}),after:z.object({date:timestamp,evidenceId:z.string(),coveragePercent:z.number().min(0).max(100)}),commonCoveragePercent:z.number().min(0).max(100),validPixels:z.number().int().positive(),totalPixels:z.number().int().positive(),
  scale:z.object({minimum:z.number().finite(),maximum:z.number().finite(),differenceLimit:z.number().positive()}),
  files:rasterFilesSchema,hashes:z.record(z.string()),notes:strings,transitionAccounting:waterTransitionAccountingSchema.optional(),
}).strict().superRefine((v,ctx)=>{
  const accounting=v.transitionAccounting;
  if(Boolean(accounting)!==Boolean(v.files.transition)||((accounting||v.files.transition)&&v.id!=='water'))ctx.addIssue({code:'custom',message:'Unresolved water transition export'});
  if(accounting){
    const p=v.grid.resolution*v.grid.resolution/1e6;
    if(!Number.isFinite(p)||p<=0||accounting.totalPixels!==v.totalPixels||accounting.validPixels!==v.validPixels||Math.abs(accounting.pixelAreaKm2-p)>Math.max(1e-15,p*1e-12))ctx.addIssue({code:'custom',message:'Transition accounting differs from recorded support'});
  }
  if(v.files.transition){
    const names=Object.entries(v.files).flatMap(([layer,pair])=>{
      if(!pair)return[];
      if(pair.raster!==`${v.id}-${layer}.tif`||pair.preview!==`${v.id}-${layer}.png`)ctx.addIssue({code:'custom',message:'Unsupported raster artifact name'});
      return[pair.raster,pair.preview];
    });
    if(Object.keys(v.hashes).length!==names.length||names.some(n=>!(/^[a-f0-9]{64}$/).test(v.hashes[n]??'')))ctx.addIssue({code:'custom',message:'Unresolved raster artifact hash'});
  }
});
export type RasterView=z.infer<typeof rasterViewSchema>;
export const evidenceRecordSchema = z.object({
  id: z.string(), sourceId: z.string(), sourceVersion: z.string(), title: z.string(), url: z.string().url(), geometry: areaSchema.nullable(),
  spatialSupport: z.object({ resolution: z.number().finite().nullable(), unit: z.string(), description: z.string() }),
  timestamps: z.object({ observedStart: z.string().nullable(), observedEnd: z.string().nullable(), publishedAt: z.string().nullable(), retrievedAt: timestamp, validThrough: z.string().nullable() }),
  quantity: z.string(), unit: z.string(), quality: z.object({ commonCoveragePercent: z.number().min(0).max(100).nullable(), notes: strings }),
  maskPolicy: z.string(), methodVersion: z.string(), hashes: z.record(z.string()), public: z.boolean(),
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;
export const claimSchema = z.object({
  id: z.string(), type: z.enum(["Observed", "Derived", "Possible explanation", "Forecast", "Scenario", "Human annotation"]), text: z.string(),
  evidenceIds: strings, methodVersion: z.string(), assumptions: strings, uncertainty: strings, applicability: strings, counterevidence: strings,
});
export type Claim = z.infer<typeof claimSchema>;
export const metricSchema = z.object({ id: z.string(), label: z.string(), value: z.number().finite().nullable(), unit: z.string(), evidenceIds: strings, description: z.string(), denominator: z.string().nullable() });
export type Metric = z.infer<typeof metricSchema>;
export const qualitySchema = z.object({ dimension: z.enum(["coverage", "measurement", "attribution", "prediction", "transfer", "delivery", "freshness"]), status: z.enum(["supported", "limited", "withheld", "unknown"]), message: z.string() });
export const briefSchema = z.object({ title: z.string(), sections: z.array(z.object({ id: z.enum(["changed", "meaning", "future", "options", "unknown"]), title: z.string(), claimIds: strings })) });
export type Brief = z.infer<typeof briefSchema>;
export const assessmentResultSchema = z.object({
  schemaVersion: z.literal("1.0"), kind: z.literal("assessment"), domain: z.enum(DOMAINS), question: z.enum(QUESTIONS), area: areaSchema,
  time: z.object({ start: date, end: date }), processedAt: timestamp, methodVersion: z.string(), title: z.string(), outcome: z.enum(["complete", "partial", "unavailable"]),
  evidence: z.array(evidenceRecordSchema), claims: z.array(claimSchema), metrics: z.array(metricSchema), quality: z.array(qualitySchema), brief: briefSchema, artifacts: strings,
  series: z.array(z.object({ id: z.string(), label: z.string(), unit: z.string(), evidenceIds: strings, points: z.array(z.object({ date: date, value: z.number().finite().nullable(), quality: z.string() })).max(2000), analysis:historyAnalysisSchema.optional(),seasonalTrend:stationSeasonalTrendSchema.optional(),seasonalSampling:seasonalSamplingSchema.optional() })).max(8).optional(),
  forecastEvaluation:gaugeEvaluationSchema.optional(),
  gaugeVintage:gaugeVintageSchema.optional(),
  forecastInformation:forecastInformationSchema.optional(),
  rasters: z.array(rasterViewSchema).max(2).optional(),
}).superRefine((r, ctx) => {
  const vintage=r.gaugeVintage;
  const snapshot=vintage?.status==='captured'?vintage.snapshot:vintage?.status==='referenced'?vintage.snapshotRef:undefined;
  const count=vintage?.status==='captured'?vintage.snapshot.observations.length:vintage?.status==='referenced'?vintage.snapshotRef.observationCount:0;
  if(r.forecastInformation){const f=r.forecastInformation;if(!['observatory-1.5.0','observatory-1.6.0'].includes(r.methodVersion)||!snapshot||f.snapshotHash!==snapshot.snapshotHash||f.issueTime!==snapshot.issueTime||f.start!==snapshot.start||f.end!==snapshot.end||f.counts.attemptedRecords!==count||f.counts.unknownCalendarDays!==snapshot.unknownDays||Object.entries(f.identity).some(([key,value])=>value!==snapshot.identity[key as keyof typeof snapshot.identity]))ctx.addIssue({code:'custom',message:'Forecast information does not match the received snapshot'});}
  if(['observatory-1.5.0','observatory-1.6.0'].includes(r.methodVersion)&&snapshot&&!r.forecastInformation)ctx.addIssue({code:'custom',message:'New received assessment requires its timing report'});
  if(vintage?.status==='referenced'&&(r.methodVersion!=='observatory-1.6.0'||!r.artifacts.includes(vintage.artifact.name)))ctx.addIssue({code:'custom',message:'Unresolved protected receipt reference'});
  if(r.artifacts.includes('gauge-vintage-snapshot.json')&&vintage?.status!=='referenced')ctx.addIssue({code:'custom',message:'Unreferenced receipt artifact'});
  const micros=(value:string)=>{const ms=Date.parse(value);return Number.isFinite(ms)?BigInt(ms)*BigInt(1000)+BigInt((value.match(/\.(\d{1,6})/)?.[1]??'').padEnd(6,'0').slice(3)||'0'):null;};
  const issue=snapshot?micros(snapshot.issueTime):null,processed=micros(r.processedAt);
  if(vintage && (r.domain!=='water' || (snapshot && (snapshot.start!==r.time.start || snapshot.end!==r.time.end || issue===null || processed===null || issue>processed))))ctx.addIssue({code:'custom',message:'Observation availability snapshot does not match this assessment'});
  const evidence = new Set(r.evidence.map(e => e.id)), claims = new Set(r.claims.map(c => c.id));
  if (evidence.size !== r.evidence.length || claims.size !== r.claims.length) ctx.addIssue({ code: "custom", message: "Evidence and claim IDs must be unique" });
  for (const c of [...r.claims, ...r.metrics]) if (c.evidenceIds.some(id => !evidence.has(id))) ctx.addIssue({ code: "custom", message: "Unresolved evidence reference" });
  for (const s of r.brief.sections) if (s.claimIds.some(id => !claims.has(id))) ctx.addIssue({ code: "custom", message: "Unresolved brief claim" });
  for (const v of r.rasters??[]) if (!evidence.has(v.before.evidenceId) || !evidence.has(v.after.evidenceId) || Object.values(v.files).some(files=>files&&Object.values(files).some(name=>!r.artifacts.includes(name)))) ctx.addIssue({code:'custom',message:'Unresolved raster artifact or evidence reference'});
  for(const s of r.series??[]) {
    if(s.evidenceIds.some(id=>!evidence.has(id)) || s.points.some((p,i)=>i>0 && p.date<=s.points[i-1].date))ctx.addIssue({code:'custom',message:'Invalid history evidence or date order'});
    if(s.analysis && s.analysis.observedCount!==s.points.filter(p=>p.value!==null).length)ctx.addIssue({code:'custom',message:'History analysis population differs from observations'});
    if(s.seasonalTrend && (s.id!=='usgs-discharge' || s.unit!=='ft^3/s' || s.evidenceIds.length!==1 || r.evidence.find(e=>e.id===s.evidenceIds[0])?.sourceId!=='usgs-daily'))ctx.addIssue({code:'custom',message:'Seasonal slope requires its single USGS discharge series'});
  }
  if(r.forecastEvaluation && !(r.series??[]).some(s=>s.id===r.forecastEvaluation?.seriesId && s.evidenceIds.every(id=>r.evidence.find(e=>e.id===id)?.sourceId==='usgs-daily')))ctx.addIssue({code:'custom',message:'Gauge evaluation requires its USGS history'});
});
export type Assessment = z.infer<typeof assessmentResultSchema>;
const footprint = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(100), geometry: areaSchema, cost: z.number().finite().nonnegative().optional(), benefit: z.number().finite().optional() }).strict();
export const scenarioRequestSchema = z.object({
  schemaVersion: z.literal("1.0"), assessmentId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), kind: z.enum(["threshold", "footprint", "options"]),
  inputs: z.object({ metricId: z.string().max(100).optional(), threshold: z.number().finite().optional(), thresholdRange: z.object({minimum:z.number().finite(),maximum:z.number().finite()}).strict().optional(), operator: z.enum(["above", "below"]).optional(), footprints: z.array(footprint).max(8).optional(), weights: z.object({ cost: z.number().finite().nonnegative(), benefit: z.number().finite().nonnegative() }).strict().refine(w => w.cost + w.benefit > 0).optional() }).strict(),
  assumptions: z.array(z.string().max(500)).max(12), objectives: z.array(z.string().max(250)).min(1).max(8),
}).strict().superRefine((r, ctx) => {
  if (r.kind === "threshold" && (!r.inputs.metricId || r.inputs.threshold === undefined || !r.inputs.operator)) ctx.addIssue({ code: "custom", message: "Select a measured quantity and threshold" });
  if (r.kind !== "threshold" && !r.inputs.footprints?.length) ctx.addIssue({ code: "custom", message: "Provide candidate footprints" });
  if(r.inputs.thresholdRange){
    const {minimum,maximum}=r.inputs.thresholdRange;
    const grid=Array.from({length:21},(_,i)=>(1-i/20)*minimum+(i/20)*maximum);
    if(r.kind!=="threshold" || !(minimum<maximum) || grid.some((v,i)=>!Number.isFinite(v)||(i>0&&v<=grid[i-1])))ctx.addIssue({code:"custom",message:"Choose a finite increasing range with 21 distinguishable threshold settings"});
  }
  if (r.inputs.footprints) {
    if (new Set(r.inputs.footprints.map(f=>f.id)).size !== r.inputs.footprints.length) ctx.addIssue({ code:"custom",message:"Candidate IDs must be unique" });
    const n=r.inputs.footprints.reduce((n,f)=>n+(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).reduce((n,p)=>n+p.reduce((n,r)=>n+r.length,0),0),0);
    if(n>512)ctx.addIssue({code:"custom",message:"Use at most 512 total candidate geometry positions"});
  }
});
export type ScenarioRequest = z.infer<typeof scenarioRequestSchema>;
export const thresholdSweepSchema=z.object({methodVersion:z.string(),metricId:z.string(),recordedValue:z.number().finite(),unit:z.string(),denominator:z.string().nullable(),evidenceIds:strings,operator:z.enum(["above","below"]),cases:z.array(z.object({threshold:z.number().finite(),meets:z.boolean(),margin:z.number().finite()}).strict()).length(21),conditionChanges:z.number().int().min(0).max(20),crossing:z.object({threshold:z.number().finite(),withinRange:z.boolean(),meetsAtEquality:z.literal(false)}).strict(),notes:strings}).strict();
export const scenarioResultSchema = z.object({ schemaVersion: z.literal("1.0"), kind: z.literal("scenario"), assessmentId: z.string(), scenarioKind: z.enum(["threshold", "footprint", "options"]), methodVersion: z.string(), changedInputs: z.record(z.unknown()), assumptions: strings, objectives: strings, outputs: z.array(metricSchema), sensitivities: strings, alternatives: z.array(z.object({ id: z.string(), name: z.string(), cost: z.number().finite().nullable(), benefit: z.number().finite().nullable(), pareto: z.boolean().nullable(), score: z.number().finite().nullable() })), claims: z.array(claimSchema), limitations: strings, artifacts: strings, weightSweep:weightSweepSchema.optional(), thresholdSweep:thresholdSweepSchema.optional() });
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;
export const forecastResultSchema = forecastSchema;
export type ForecastResult = z.infer<typeof forecastResultSchema>;
const jobBase = { schemaVersion: z.literal("1.0"), id: z.string(), status: z.enum(["queued", "running", "failed", "cancelled", "completed"]), phase: z.string(), createdAt: timestamp, updatedAt: timestamp, error: z.object({ code: z.string(), message: z.string() }).nullable() };
export const assessmentJobSchema = z.object({ ...jobBase, kind: z.literal("assessment"), request: assessmentRequestSchema, result: assessmentResultSchema.nullable() });
export type AssessmentJob = z.infer<typeof assessmentJobSchema>;
export const scenarioJobSchema = z.object({ ...jobBase, kind: z.literal("scenario"), request: scenarioRequestSchema, result: scenarioResultSchema.nullable() });
export type ScenarioJob = z.infer<typeof scenarioJobSchema>;
export const sourceSchema = z.object({ id: z.string(), title: z.string(), domains: z.array(z.enum(DOMAINS)), url: z.string().url(), description: z.string(), spatialSupport: z.string(), access: z.string(), capabilities: strings, limitations: strings, status: z.enum(["available", "configuration_required", "research", "unsupported"]) });
export type ObservatorySource = z.infer<typeof sourceSchema>;
export const assessmentArtifactUrl = (id: string, name: string) => `/api/assessments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`;
