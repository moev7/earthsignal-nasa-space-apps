import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const number = z.number().finite();
const count = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const notes = z.array(z.string()).max(64);

export const historyAnalysisSchema = z.object({
  methodVersion: z.literal("history-descriptive-v1"), inputHash: hash,
  observedCount: count.max(2000), calendarDays: count, missingDays: count, maxGapDays: count,
  firstDate: date.nullable(), lastDate: date.nullable(), latest: number.nullable(), endpointDifference: number.nullable(),
  spread: z.object({ median: number.nullable(), p05: number.nullable(), p95: number.nullable() }).strict(),
  histogram: z.array(z.object({ lower: number, upper: number, count }).strict()).max(12),
  rolling: z.array(z.object({ date, value: number.nullable() }).strict()).max(128), rollingWindowDays: z.literal(28),
  seasonal: z.object({ supported: z.boolean(), sampleCount: count, distinctYearCount: count,
    median: number.nullable(), mad: number.nonnegative().nullable(), percentile: number.min(0).max(100).nullable(), reason: z.string() }).strict(),
  notes,
}).strict().superRefine((a, ctx) => {
  if (a.observedCount + a.missingDays !== a.calendarDays || a.histogram.reduce((n,b) => n+b.count,0) !== a.observedCount)
    ctx.addIssue({ code:"custom",message:"History population counts must reconcile" });
  if (a.histogram.some(b=>b.lower>=b.upper))ctx.addIssue({code:"custom",message:"Histogram bins must have positive width"});
  if (a.seasonal.supported && (a.seasonal.sampleCount<12 || a.seasonal.distinctYearCount<2 || a.seasonal.percentile===null || a.seasonal.median===null || a.seasonal.mad===null))
    ctx.addIssue({code:"custom",message:"Seasonal support requires distinct earlier years and finite context"});
  if (!a.seasonal.supported && [a.seasonal.median,a.seasonal.mad,a.seasonal.percentile].some(v=>v!==null))
    ctx.addIssue({code:"custom",message:"Unsupported seasonal estimates must be withheld"});
});
export type HistoryAnalysis = z.infer<typeof historyAnalysisSchema>;

const samplingEstimand=z.object({median:number.nullable(),percentile:number.min(0).max(100).nullable(),estimand:z.string()}).strict();
export const seasonalSamplingSchema=z.object({
  methodVersion:z.literal('seasonal-sampling-sensitivity-v1'),inputHash:hash,targetDate:date.nullable(),targetValue:number.nullable(),
  supported:z.boolean(),sampleCount:count.max(2000),yearCount:count.max(2000),windowDays:z.literal(30),
  byYear:z.array(z.object({year:z.number().int().min(1).max(9999),count:count.min(1).max(2000),dates:z.array(date).max(2000),median:number}).strict()).max(2000),
  maxYearSharePercent:number.min(0).max(100).nullable(),pooled:samplingEstimand,yearBalanced:samplingEstimand,
  percentileDifferencePoints:number.min(-100).max(100).nullable(),directionChanges:z.boolean().nullable(),
  sparseYears:z.array(z.number().int()).max(2000),notes,
}).strict().superRefine((s,ctx)=>{
  const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
  if(s.byYear.length!==s.yearCount || s.byYear.reduce((sum,y)=>sum+y.count,0)!==s.sampleCount ||
     new Set(s.byYear.map(y=>y.year)).size!==s.yearCount || s.byYear.some(y=>y.count!==y.dates.length || new Set(y.dates).size!==y.count || y.dates.some(d=>Number(d.slice(0,4))!==y.year || (s.targetDate!==null && y.year>=Number(s.targetDate.slice(0,4))))))invalid('Seasonal sampling support must reconcile');
  if((s.targetDate===null)!==(s.targetValue===null))invalid('Sampling target needs a recorded date and value');
  if(s.maxYearSharePercent!==(s.sampleCount?100*Math.max(...s.byYear.map(y=>y.count))/s.sampleCount:null))invalid('Year sampling share must reconcile');
  if(s.sparseYears.join(',')!==s.byYear.filter(y=>y.count<3).map(y=>y.year).join(','))invalid('Sparse-year display flag must reconcile');
  if(s.supported && (s.sampleCount<12 || s.yearCount<2 || s.targetDate===null || [s.pooled.median,s.pooled.percentile,s.yearBalanced.median,s.yearBalanced.percentile,s.percentileDifferencePoints,s.directionChanges].some(v=>v===null)))invalid('Sampling comparison needs dated support');
  if(!s.supported && [s.pooled.median,s.pooled.percentile,s.yearBalanced.median,s.yearBalanced.percentile,s.percentileDifferencePoints,s.directionChanges].some(v=>v!==null))invalid('Unsupported sampling comparison must be withheld');
  if(s.supported && Math.abs((s.yearBalanced.percentile!-s.pooled.percentile!)-s.percentileDifferencePoints!)>1e-10)invalid('Sampling percentile difference must reconcile');
});
export type SeasonalSampling=z.infer<typeof seasonalSamplingSchema>;

export const stationSeasonalTrendSchema = z.object({
  methodVersion:z.literal('station-seasonal-sen-v1'),inputHash:hash,status:z.enum(['withheld','descriptive']),reason:z.string(),
  unit:z.literal('ft^3/s/year'),slope:number.nullable(),years:z.array(z.number().int().min(1).max(9999)).max(7),
  commonMonths:z.array(z.number().int().min(1).max(12)).max(12),pairCount:count,
  months:z.array(z.object({year:z.number().int(),month:z.number().int().min(1).max(12),calendarDays:count.min(28).max(31),
    recordedDays:count.max(31),approvedDays:count.max(31),excludedDays:count.max(31),longestExcludedRun:count.max(31),
    complete:z.boolean(),eligible:z.boolean(),median:number.nonnegative().nullable()}).strict()).max(72),
  byMonth:z.array(z.object({month:z.number().int().min(1).max(12),slope:number,pairCount:count}).strict()).max(12),
  leaveYearOut:z.array(z.object({omittedYear:z.number().int(),slope:number}).strict()).max(7),
  sensitivityRange:z.object({minimum:number,maximum:number}).strict().nullable(),signStable:z.boolean().nullable(),
  references:z.array(z.string().url()).max(8),notes,
}).strict().superRefine((t,ctx)=>{
  const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
  if(t.months.some(m=>m.approvedDays+m.excludedDays!==m.recordedDays || m.recordedDays>m.calendarDays || m.longestExcludedRun>m.excludedDays || m.eligible!==Boolean(m.complete&&m.approvedDays*5>=m.calendarDays*4) || (m.eligible?m.median===null:m.median!==null))) invalid('Monthly support must reconcile');
  if(new Set(t.years).size!==t.years.length || new Set(t.commonMonths).size!==t.commonMonths.length)invalid('Seasonal support must be unique');
  if(t.status==='withheld' && (t.slope!==null || t.sensitivityRange!==null || t.signStable!==null || t.byMonth.length || t.leaveYearOut.length || t.pairCount))invalid('Withheld trend has numerical findings');
  if(t.status==='descriptive'){
    const pairs=t.years.length*(t.years.length-1)/2;
    if(t.years.length<3 || t.commonMonths.length<6 || t.slope===null || !t.sensitivityRange || t.signStable===null || t.byMonth.length!==t.commonMonths.length || t.leaveYearOut.length!==t.years.length || t.pairCount!==pairs*t.commonMonths.length)invalid('Descriptive trend needs fixed seasonal support');
    if(t.byMonth.some((m,i)=>m.month!==t.commonMonths[i] || m.pairCount!==pairs) || t.leaveYearOut.some((v,i)=>v.omittedYear!==t.years[i]))invalid('Sensitivity must retain recorded years and common months');
    if(t.sensitivityRange && (t.sensitivityRange.minimum!==Math.min(...t.leaveYearOut.map(v=>v.slope)) || t.sensitivityRange.maximum!==Math.max(...t.leaveYearOut.map(v=>v.slope))))invalid('Sensitivity range must reconcile');
    if(t.slope!==null && t.signStable!==t.leaveYearOut.every(v=>Math.sign(v.slope)===Math.sign(t.slope!)))invalid('Sensitivity sign must reconcile');
    if(t.years.some(y=>t.commonMonths.some(m=>!t.months.some(row=>row.year===y&&row.month===m&&row.eligible))))invalid('Common months must qualify in every year');
  }
});

const baselines = z.array(z.object({ model:z.string(),mae:number.nonnegative() }).strict()).max(4);
const validationFields = {
  methodVersion:z.string(), trainingStart:date, trainingEnd:date, testStart:date, testEnd:date,
  origins:count, mae:number.nonnegative(), intervalCoverage:number.min(0).max(1), intervalWidth:number.nonnegative(),
  applicability:notes, limitations:notes,
};
export const intervalDiagnosticsSchema=z.object({methodVersion:z.literal('forecast-interval-diagnostics-v1'),nominalCoverage:z.literal(.9),boundaryTolerance:z.literal(1e-10),
  intervalScore:number.nonnegative(),belowCount:count,withinCount:count,aboveCount:count,longestMissRun:count,negativePredictionCount:count,
  calibrationOrigins:count.min(30),calibrationRank:count.min(1),baselineScores:z.array(z.object({model:z.enum(['persistence','seasonal-naive']),intervalScore:number.nonnegative(),intervalCoverage:number.min(0).max(1),intervalWidth:number.nonnegative()}).strict()).length(2),
}).strict().superRefine((d,ctx)=>{
  if(d.longestMissRun>d.belowCount+d.aboveCount || d.negativePredictionCount>d.belowCount+d.withinCount+d.aboveCount || d.calibrationRank!==Math.ceil((d.calibrationOrigins+1)*.9) || d.calibrationRank>d.calibrationOrigins || new Set(d.baselineScores.map(b=>b.model)).size!==2)ctx.addIssue({code:'custom',message:'Interval diagnostics must reconcile'});
});
export const forecastSchema = z.object({ schemaVersion:z.literal("1.0"), target:z.string(),
  issueTime:z.string().datetime({offset:true}), horizonDays:z.number().int().positive(), model:z.string(), modelVersion:z.string(),
  distribution:z.object({point:number,lower:number,upper:number,unit:z.string()}).strict(),
  baselines, validation:z.object(validationFields).strict(), validThrough:z.string().datetime({offset:true}),
}).strict().superRefine((f,ctx)=>{
  if(f.distribution.lower>f.distribution.point || f.distribution.upper<f.distribution.point || Date.parse(f.validThrough)<=Date.parse(f.issueTime))
    ctx.addIssue({code:"custom",message:"Forecast interval or issue validity is invalid"});
});
export const gaugeEvaluationSchema = z.object({
  seriesId:z.literal("usgs-discharge"), methodVersion:z.string(),status:z.literal("experimental"),
  selectionHash:hash.nullable(),sourceInputHash:hash.nullable(),
  folds:z.object({selectionStart:date,selectionEnd:date,calibrationStart:date,calibrationEnd:date,testStart:date}).strict().nullable(),
  forecasts:z.array(forecastSchema).max(3),withheld:notes,
  validation:z.array(z.object({...validationFields,model:z.string(),horizonDays:z.number().int().positive(),
    baselinePerformance:baselines,improvementFraction:number,calibrationOrigins:count,intervalDiagnostics:intervalDiagnosticsSchema.optional()}).strict()).max(3),notes,
}).strict().superRefine((e,ctx)=>{
  if(e.validation.some(v=>v.intervalDiagnostics&&(v.intervalDiagnostics.belowCount+v.intervalDiagnostics.withinCount+v.intervalDiagnostics.aboveCount!==v.origins || Math.abs(v.intervalDiagnostics.withinCount/v.origins-v.intervalCoverage)>1e-12 || v.calibrationOrigins!==v.intervalDiagnostics.calibrationOrigins)))ctx.addIssue({code:'custom',message:'Forecast diagnostic population differs from validation'});
});

export const weightSweepSchema = z.object({
  methodVersion:z.string(),cases:z.array(z.object({costShare:number.min(0).max(1),winners:z.array(z.string()).max(8)}).strict()).length(21),
  winnerCounts:z.array(z.object({id:z.string(),count:count.max(21),total:z.literal(21)}).strict()).max(8),
  rankingChanges:count.max(20),notes,
}).strict();
