import { z } from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v);
const time=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(v=>Number.isFinite(Date.parse(v)));
const text=z.string().min(1).max(256);
const identity=z.object({station:z.string().regex(/^USGS-\d{8,15}$/),timeSeriesId:z.string().min(1).max(128),parameter:z.literal('00060'),statistic:z.literal('00003'),unit:z.literal('ft^3/s')}).strict();
const properties=z.object({country_code:z.string().max(32).nullable().optional(),time_zone_abbreviation:z.string().max(32).nullable().optional(),uses_daylight_savings:z.string().max(32).nullable().optional()}).strict();
const policy=z.literal('usgs-observation-vintages-v1');
const receipt=z.object({policyVersion:policy,receivedAt:time,insertedVersions:z.number().int().min(0).max(2000),unchangedRecords:z.number().int().min(0).max(2000)}).strict();
const summary=z.object({policyVersion:policy,availabilityBasis:z.literal('local-receipt-only'),identity,issueTime:time,start:day,end:day,calendarDays:z.number().int().min(1).max(2000),unknownDays:z.number().int().min(0).max(2000),snapshotHash:hash,observationCount:z.number().int().min(0).max(2000),qualifiedRecords:z.number().int().min(0).max(2000),withdrawnRecords:z.number().int().min(0).max(2000)}).strict();
const observation=z.object({identity,date:day,value:z.number().finite().nonnegative().nullable(),quality:text,qualifiers:z.array(z.string().min(1).max(64)).max(16),stationTimeProperties:properties,revision:z.number().int().min(1).max(100000),receivedAt:time,firstReceivedAt:time,contentHash:hash,stationPropertiesHash:hash,sourceResponseHash:hash,sourceMetadataHash:hash,versionHash:hash}).strict();
export const gaugeVintageSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('unavailable'),reason:z.enum(['invalid_input','receipt_order','receipt_tie','version_limit','storage_limit','ledger_unavailable','schema_mismatch'])}).strict(),
  z.object({status:z.literal('captured'),receipt,snapshot:z.object({policyVersion:policy,availabilityBasis:z.literal('local-receipt-only'),identity,issueTime:time,start:day,end:day,calendarDays:z.number().int().min(1).max(2000),unknownDays:z.number().int().min(0).max(2000),observations:z.array(observation).max(2000),snapshotHash:hash}).strict()}).strict(),
  z.object({status:z.literal('referenced'),referenceVersion:z.literal('gauge-receipt-reference-v1'),receipt,snapshotRef:summary,artifact:z.object({name:z.literal('gauge-vintage-snapshot.json'),bytes:z.number().int().positive().max(8*1024*1024),sha256:hash}).strict()}).strict(),
]).superRefine((v,ctx)=>{
  if(v.status==='unavailable')return;
  const s=v.status==='captured'?v.snapshot:v.snapshotRef;
  const rows=v.status==='captured'?v.snapshot.observations:[];
  const observationCount=v.status==='captured'?rows.length:v.snapshotRef.observationCount;
  const days=1+(Date.parse(s.end)-Date.parse(s.start))/86400000;
  const count=v.receipt.insertedVersions+v.receipt.unchangedRecords;
  if(s.calendarDays!==days || s.unknownDays!==days-observationCount || count<1 || count>2000 || v.receipt.receivedAt!==s.issueTime || (v.status==='referenced'&&(v.snapshotRef.qualifiedRecords>observationCount||v.snapshotRef.withdrawnRecords>observationCount)))ctx.addIssue({code:'custom',message:'Observation vintage population or receipt mismatch'});
  if(rows.some((r,i)=>r.date<s.start || r.date>s.end || (i>0&&r.date<=rows[i-1].date) || JSON.stringify(r.identity)!==JSON.stringify(s.identity) || r.firstReceivedAt>r.receivedAt || r.receivedAt>s.issueTime))ctx.addIssue({code:'custom',message:'Observation vintage identity, order or availability mismatch'});
});
export type GaugeVintage=z.infer<typeof gaugeVintageSchema>;
